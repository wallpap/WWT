import metadata from "../../package.json" with { type: "json" };
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { appPaths } from "../platform/app-paths.ts";
import { extractAppUpdate, startAppUpdateWorker, type PreparedAppFile } from "../platform/app-update.ts";
import { ResourceDownloadCache } from "../game/resource-download.ts";
import { ensureNoResourceSymlinks } from "../game/resource-path.ts";
import { compareAppVersions, fetchAppRelease, normalizeUpdateSource, type AppRelease } from "./update-release.ts";

const zipExtensionLength = ".zip".length;

export interface AppUpdateOffer {
  id: string;
  source: string;
  currentVersion: string;
  available: boolean;
  release: AppRelease;
}
export interface AppUpdateProgress {
  phase: "download" | "verify" | "extract";
  completedBytes: number;
  totalBytes: number;
}
export interface PreparedAppUpdate {
  id: string;
  version: string;
  directory: string;
  fileCount: number;
}
interface UpdaterOptions {
  root?: string;
  dataDirectory?: string;
  currentVersion?: string;
  portable?: boolean;
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  extract?: typeof extractAppUpdate;
  worker?: typeof startAppUpdateWorker;
}
export class AppUpdateService {
  readonly currentVersion: string;
  readonly #root: string;
  readonly #data: string;
  readonly #portable: boolean;
  readonly #fetcher: NonNullable<UpdaterOptions["fetcher"]>;
  #offer: AppUpdateOffer | null = null;
  #prepared: (PreparedAppUpdate & { planPath: string }) | null = null;
  #controller: AbortController | null = null;
  #checking = false;
  #installing = false;
  constructor(private readonly options: UpdaterOptions = {}) {
    this.#root = resolve(options.root ?? appPaths.rootDirectory);
    this.#data = resolve(options.dataDirectory ?? appPaths.dataDirectory);
    this.currentVersion = options.currentVersion ?? metadata.version;
    this.#portable = options.portable ?? Bun.isStandaloneExecutable;
    this.#fetcher = options.fetcher ?? fetch;
  }
  get busy(): boolean {
    return this.#checking || this.#controller !== null || this.#installing;
  }
  get preparing(): boolean {
    return this.#controller !== null;
  }
  get installing(): boolean {
    return this.#installing;
  }
  cancel(): void {
    this.#controller?.abort(new Error("应用更新下载已取消"));
  }
  async check(source: string): Promise<AppUpdateOffer> {
    if (this.busy) throw new Error("应用更新正在处理中");
    this.#offer = null;
    this.#checking = true;
    try {
      const normalized = normalizeUpdateSource(source);
      const release = await fetchAppRelease(normalized, this.#fetcher);
      const offer = {
        id: randomUUID(),
        source: normalized,
        currentVersion: this.currentVersion,
        release,
        available: compareAppVersions(release.version, this.currentVersion) > 0,
      };
      this.#offer = offer;
      return structuredClone(offer);
    } finally {
      this.#checking = false;
    }
  }
  async prepare(id: string, onProgress?: (progress: AppUpdateProgress) => void): Promise<PreparedAppUpdate> {
    if (!this.#portable) throw new Error("应用更新安装需使用 Windows 便携版");
    if (this.busy) throw new Error("应用更新正在处理中");
    const offer = this.#offer;
    if (!offer || offer.id !== id || !offer.available) throw new Error("请重新检查应用更新");
    this.#controller = new AbortController();
    const signal = this.#controller.signal;
    const cache = new ResourceDownloadCache(join(this.#data, "app-update-cache"));
    const file = {
      path: offer.release.asset.name,
      url: offer.release.asset.url,
      size: offer.release.asset.size,
      md5: null,
    };
    let workspace: string | null = null;
    try {
      const archive = await cache.download(file, {
        signal,
        fetcher: async (input, init) => {
          const response = await this.#fetcher(input, {
            ...init,
            redirect: "follow",
          });
          if (response.url && new URL(response.url).protocol !== "https:") throw new Error("更新包跳转到无效地址");
          return response;
        },
        onBytes: (completedBytes) => {
          onProgress?.({
            phase: "download",
            completedBytes,
            totalBytes: file.size,
          });
        },
      });
      onProgress?.({
        phase: "verify",
        completedBytes: file.size,
        totalBytes: file.size,
      });
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(archive)) {
        signal.throwIfAborted();
        hash.update(chunk);
      }
      if (hash.digest("hex") !== offer.release.asset.sha256) {
        await cache.discard(file);
        throw new Error("应用更新包 SHA-256 校验失败");
      }
      await ensureNoResourceSymlinks(this.#root);
      await mkdir(this.#root, { recursive: true });
      workspace = await mkdtemp(join(this.#root, ".wwt-app-update-"));
      onProgress?.({
        phase: "extract",
        completedBytes: file.size,
        totalBytes: file.size,
      });
      const files: PreparedAppFile[] = await (this.options.extract ?? extractAppUpdate)(archive, workspace, file.path.slice(0, -zipExtensionLength), signal);
      signal.throwIfAborted();
      const planPath = join(workspace, "plan.json");
      await writeFile(
        planPath,
        JSON.stringify({
          version: offer.release.version,
          root: this.#root,
          files,
          processId: process.pid,
        }),
        { flag: "wx" },
      );
      const previous = this.#prepared;
      this.#prepared = {
        id: offer.id,
        version: offer.release.version,
        directory: workspace,
        fileCount: files.length,
        planPath,
      };
      workspace = null;
      // 已完成校验的暂存包不受旧缓存清理失败影响。
      if (previous) await rm(previous.directory, { recursive: true, force: true }).catch(() => {});
      await cache.discard(file).catch(() => {});
      return {
        id: this.#prepared.id,
        version: this.#prepared.version,
        directory: this.#prepared.directory,
        fileCount: this.#prepared.fileCount,
      };
    } finally {
      try {
        if (workspace) await rm(workspace, { recursive: true, force: true });
      } finally {
        this.#controller = null;
      }
    }
  }
  async install(id: string): Promise<void> {
    if (!this.#portable || (!this.options.worker && basename(process.execPath).toLowerCase() !== "wwt.exe")) throw new Error("请使用便携包中的 WWT.exe 执行应用更新");
    if (this.busy) throw new Error("应用更新正在处理中");
    const prepared = this.#prepared;
    if (!prepared || prepared.id !== id || this.#offer?.id !== id) throw new Error("请先下载并校验当前更新包");
    this.#installing = true;
    try {
      await (this.options.worker ?? startAppUpdateWorker)(prepared.planPath);
    } catch (error) {
      this.#installing = false;
      throw error;
    }
  }
  async lastResult(): Promise<{ status: string; message: string } | null> {
    await ensureNoResourceSymlinks(this.#root);
    const entries = await readdir(this.#root, { withFileTypes: true }).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    });
    const results: { status: string; message: string; modified: number }[] = [];
    for (const entry of entries.filter((entry) => entry.isDirectory() && /^\.wwt-app-update-[\w-]+$/.test(entry.name))) {
      const path = join(this.#root, entry.name, "result.json");
      await ensureNoResourceSymlinks(path);
      try {
        const value: unknown = JSON.parse(await readFile(path, "utf8"));
        if (typeof value === "object" && value !== null && "status" in value && typeof value.status === "string" && "message" in value && typeof value.message === "string")
          results.push({
            status: value.status,
            message: value.message,
            modified: (await stat(path)).mtimeMs,
          });
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw new Error("读取上次应用更新结果失败");
      }
    }
    const latest = results.sort((a, b) => b.modified - a.modified)[0];
    return latest ? { status: latest.status, message: latest.message } : null;
  }
}
