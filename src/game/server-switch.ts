import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fetchOfficialResourceManifest, type OfficialResourceFile, type OfficialResourceSource } from "./official-resources.ts";
import { ensureNoResourceSymlinks, normalizeResourcePath, validateResourcePaths } from "./resource-path.ts";
import { ResourceTransaction, recoverResourceTransactions, type InstallEntry } from "./resource-transaction.ts";
import { installOfficialResources, type ResourceUpdateOptions } from "./resource-update.ts";
import { checkLocalResources } from "./resource-check.ts";
import { isGameProcessRunning } from "./running-process.ts";

export type SwitchSource = "mainland" | "bilibili";
export interface ServerCache {
  source: SwitchSource;
  version: string;
  files: OfficialResourceFile[];
}
export interface ServerSwitchStatus {
  activeSource: OfficialResourceSource | null;
  mainland: { ready: boolean; version: string };
  bilibili: { ready: boolean; version: string };
}
export interface ServerSwitchResult {
  source: SwitchSource;
  version: string;
  notice?: string;
}
const executable = "Client/Binaries/Win64/Client-Win64-Shipping.exe";
const sdk = "Client/Binaries/Win64/ThirdParty/KrPcSdk_Mainland";
const antiCheat = "Client/Binaries/Win64/AntiCheatExpert";
const components: InstallEntry[] = [
  { path: executable, kind: "file" },
  { path: sdk, kind: "directory" },
  { path: antiCheat, kind: "directory" },
];
const appIds = {
  mainland: "10003",
  bilibili: "10004",
} as const;
function assertSource(source: string): asserts source is SwitchSource {
  if (source !== "mainland" && source !== "bilibili") throw new Error("服务器文件切换支持国内官服与 B 服");
}
function cacheRoot(root: string, source: SwitchSource): string {
  assertSource(source);
  return join(resolve(root), ".wwt-server-cache", source);
}
function required(path: string): boolean {
  const value = normalizeResourcePath(path).toLowerCase();
  return value === executable.toLowerCase() || value.startsWith(`${sdk.toLowerCase()}/`) || value.startsWith(`${antiCheat.toLowerCase()}/`);
}
function validateComponents(files: readonly OfficialResourceFile[]): void {
  validateResourcePaths(files.map((file) => file.path));
  if (!files.some((file) => file.path.toLowerCase() === executable.toLowerCase()) || !files.some((file) => file.path.toLowerCase().startsWith(`${sdk.toLowerCase()}/`)) || !files.some((file) => file.path.toLowerCase().startsWith(`${antiCheat.toLowerCase()}/`)) || files.some((file) => !required(file.path))) throw new Error("切服组件清单缺少主程序、SDK 或反作弊文件");
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("服务器配置格式无效");
  return value as Record<string, unknown>;
}
async function config(root: string): Promise<Record<string, unknown>> {
  const path = join(root, "launcherDownloadConfig.json");
  await ensureNoResourceSymlinks(path);
  try {
    return object(JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, "")) as unknown);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
}
async function isDirectory(path: string): Promise<boolean> {
  await ensureNoResourceSymlinks(path);
  try {
    return (await lstat(path)).isDirectory();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
export async function detectServerSource(root: string): Promise<OfficialResourceSource | null> {
  let configured: OfficialResourceSource | null = null;
  try {
    const id = String((await config(root))["appId"] ?? "");
    if (id === "50004") return null;
    configured = (Object.entries(appIds).find(([, value]) => value === id)?.[0] as OfficialResourceSource | undefined) ?? null;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  const directorySource = (await isDirectory(join(root, sdk, "KRSDKRes/Bilibili"))) ? "bilibili" : (await isDirectory(join(root, sdk))) ? "mainland" : null;
  return configured && directorySource && configured !== directorySource ? null : (configured ?? directorySource);
}
async function readCache(root: string, source: SwitchSource): Promise<ServerCache | null> {
  const path = join(cacheRoot(root, source), "cache.json");
  await ensureNoResourceSymlinks(path);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw new Error("读取切服缓存失败，请重新准备缓存");
  }
  const row = object(value);
  if (row["source"] !== source || typeof row["version"] !== "string" || !Array.isArray(row["files"])) throw new Error("切服缓存归属或格式无效");
  const files = row["files"].map((item) => {
    const file = object(item);
    if (typeof file["path"] !== "string" || typeof file["size"] !== "number" || !Number.isSafeInteger(file["size"]) || file["size"] < 0 || typeof file["md5"] !== "string" || !/^[a-f\d]{32}$/i.test(file["md5"])) throw new Error("切服缓存文件记录无效");
    return {
      path: normalizeResourcePath(file["path"]),
      size: file["size"],
      md5: file["md5"].toLowerCase(),
      url: "",
    };
  });
  validateComponents(files);
  return { source, version: row["version"], files };
}
async function fileHash(path: string): Promise<string> {
  const hash = createHash("md5");
  for await (const chunk of Bun.file(path).stream()) hash.update(chunk);
  return hash.digest("hex");
}
async function captureFiles(root: string): Promise<OfficialResourceFile[]> {
  const files: OfficialResourceFile[] = [];
  async function visit(path: string): Promise<void> {
    const absolute = join(root, path);
    await ensureNoResourceSymlinks(absolute);
    const info = await lstat(absolute);
    if (info.isDirectory()) {
      for (const item of await readdir(absolute)) await visit(`${path}/${item}`);
    } else if (info.isFile())
      files.push({
        path,
        size: info.size,
        md5: await fileHash(absolute),
        url: "",
      });
    else throw new Error("切服组件包含不支持的文件类型");
  }
  for (const entry of components) await visit(entry.path);
  validateComponents(files);
  return files;
}
async function stageFiles(from: string, to: string, files: readonly OfficialResourceFile[], signal?: AbortSignal): Promise<void> {
  for (const file of files) {
    signal?.throwIfAborted();
    const source = join(from, file.path),
      target = join(to, file.path);
    await ensureNoResourceSymlinks(source);
    await ensureNoResourceSymlinks(target);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}
async function finish(transaction: ResourceTransaction): Promise<string | undefined> {
  try {
    await transaction.finish();
    return undefined;
  } catch (error) {
    if (!transaction.committed) throw error;
    return error instanceof Error ? error.message : "切换已完成，备份清理失败";
  }
}

export class ServerSwitchService {
  #busy = false;
  constructor(
    private readonly fetchManifest = fetchOfficialResourceManifest,
    private readonly isRunning: () => boolean | Promise<boolean> = isGameProcessRunning,
  ) {}
  get isBusy(): boolean {
    return this.#busy;
  }
  async #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#busy) throw new Error("正在处理服务器文件，请等待完成");
    this.#busy = true;
    try {
      return await operation();
    } finally {
      this.#busy = false;
    }
  }
  async #recover(root: string): Promise<void> {
    await recoverResourceTransactions(root);
    for (const source of ["mainland", "bilibili"] as const) await recoverResourceTransactions(cacheRoot(root, source));
  }
  inspect(root: string): Promise<ServerSwitchStatus> {
    return this.#exclusive(async () => {
      await this.#recover(root);
      const status: ServerSwitchStatus = {
        activeSource: await detectServerSource(root),
        mainland: { ready: false, version: "" },
        bilibili: { ready: false, version: "" },
      };
      for (const source of ["mainland", "bilibili"] as const) {
        const cache = await readCache(root, source);
        if (!cache) continue;
        const checked = await checkLocalResources(cacheRoot(root, source), cache.files);
        status[source] = {
          ready: checked.validCount === cache.files.length,
          version: cache.version,
        };
      }
      return status;
    });
  }
  prepare(root: string, source: SwitchSource, options: ResourceUpdateOptions = {}): Promise<ServerSwitchResult> {
    return this.#exclusive(async () => {
      assertSource(source);
      await this.#recover(root);
      options.signal?.throwIfAborted();
      const manifest = await this.fetchManifest(source, false, options.fetcher);
      if (manifest.source !== source || manifest.predownload) throw new Error("官方切服资源来源不一致");
      const files = manifest.files.filter((file) => required(file.path));
      validateComponents(files);
      const target = cacheRoot(root, source);
      const transaction = await ResourceTransaction.begin(target);
      let notice: string | undefined;
      try {
        const downloads: OfficialResourceFile[] = [];
        const checks = await checkLocalResources(root, files, {
          ...(options.signal ? { signal: options.signal } : {}),
        });
        for (let index = 0; index < files.length; index++) {
          const file = files[index]!;
          if (checks.files[index]?.state === "valid") await stageFiles(root, transaction.staging, [file], options.signal);
          else downloads.push(file);
        }
        if (downloads.length)
          await installOfficialResources(transaction.staging, downloads, {
            ...options,
            downloadCache: options.downloadCache ?? join(root, ".wwt-download-cache"),
          });
        const checked = await checkLocalResources(transaction.staging, files, {
          ...(options.signal ? { signal: options.signal } : {}),
        });
        if (checked.files.some((file) => file.state !== "valid" && file.state !== "unchecked")) throw new Error("切服组件校验失败");
        const verified = await captureFiles(transaction.staging);
        const cache: ServerCache = {
          source,
          version: manifest.version,
          files: verified,
        };
        await Bun.write(join(transaction.staging, "cache.json"), `${JSON.stringify(cache, null, 2)}\n`);
        await transaction.installEntries([...components, { path: "cache.json", kind: "file" }], options.signal);
      } finally {
        notice = await finish(transaction);
      }
      return {
        source,
        version: manifest.version,
        ...(notice ? { notice } : {}),
      };
    });
  }
  apply(root: string, source: SwitchSource, options: ResourceUpdateOptions = {}): Promise<ServerSwitchResult> {
    return this.#exclusive(async () => {
      assertSource(source);
      options.signal?.throwIfAborted();
      if (await this.isRunning()) throw new Error("请先退出游戏再切换服务器文件");
      await this.#recover(root);
      const active = await detectServerSource(root);
      if (String((await config(root))["appId"]) === "50004" || (await isDirectory(join(root, "Client/Binaries/Win64/ThirdParty/KrPcSdk_Global")))) throw new Error("所选安装不属于国服，无法切换渠道");
      const cache = await readCache(root, source);
      if (!cache) throw new Error("目标服务器缓存尚未准备");
      const verified = await checkLocalResources(cacheRoot(root, source), cache.files);
      if (verified.validCount !== cache.files.length) throw new Error("目标切服缓存损坏，请重新准备缓存");
      const transaction = await ResourceTransaction.begin(root);
      let notice: string | undefined;
      try {
        const originalConfig = await config(root);
        if (typeof originalConfig["version"] !== "string" || originalConfig["version"] !== cache.version) throw new Error("切服缓存版本与当前安装不一致，请重新准备对应版本缓存");
        if ((active === "mainland" || active === "bilibili") && active !== source) {
          const previous = await captureFiles(root),
            destination = cacheRoot(root, active);
          const backup = await ResourceTransaction.begin(destination);
          try {
            await stageFiles(root, backup.staging, previous, options.signal);
            await Bun.write(join(backup.staging, "cache.json"), `${JSON.stringify({ source: active, version: typeof originalConfig["version"] === "string" ? originalConfig["version"] : "", files: previous }, null, 2)}\n`);
            await backup.installEntries([...components, { path: "cache.json", kind: "file" }], options.signal);
          } finally {
            const result = await finish(backup);
            if (result) notice = result;
          }
        }
        await stageFiles(cacheRoot(root, source), transaction.staging, cache.files, options.signal);
        const staged = await checkLocalResources(transaction.staging, cache.files, { ...(options.signal ? { signal: options.signal } : {}) });
        if (staged.validCount !== cache.files.length) throw new Error("切服暂存组件校验失败");
        await Bun.write(join(transaction.staging, "launcherDownloadConfig.json"), `${JSON.stringify({ ...originalConfig, appId: appIds[source] }, null, 2)}\n`);
        if ((await detectServerSource(transaction.staging)) !== source) throw new Error("缓存 SDK 与目标服务器不一致，请重新准备缓存");
        if (await this.isRunning()) throw new Error("游戏已启动，请退出后重新切换");
        await transaction.installEntries([...components, { path: "launcherDownloadConfig.json", kind: "file" }], options.signal);
      } finally {
        const result = await finish(transaction);
        if (result) notice = result;
      }
      return { source, version: cache.version, ...(notice ? { notice } : {}) };
    });
  }
  deleteCache(root: string, source: SwitchSource): Promise<void> {
    return this.#exclusive(async () => {
      assertSource(source);
      await this.#recover(root);
      const target = cacheRoot(root, source);
      await ensureNoResourceSymlinks(target);
      await rm(target, { recursive: true, force: true });
    });
  }
}
