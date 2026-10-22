import { acquireProcessLock } from "../platform/process-lock.ts";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, rm, rmdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ensureNoResourceSymlinks, normalizeResourcePath, validateResourcePaths } from "./resource-path.ts";

const installJournalVersion = 1;

export interface InstallEntry {
  path: string;
  kind: "file" | "directory";
  remove?: boolean;
}
interface Entry {
  path: string;
  hadOriginal: boolean;
  replacing: boolean;
  kind?: "file" | "directory";
  remove?: boolean;
}
interface Journal {
  version: typeof installJournalVersion;
  phase: "downloading" | "installing" | "committed";
  entries: Entry[];
}
const activeRoots = new Set<string>();
const transactionName = /^\.wwt-transaction-[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;

async function existsEntry(path: string, kind: InstallEntry["kind"] = "file"): Promise<boolean> {
  await ensureNoResourceSymlinks(path);
  try {
    const info = await lstat(path);
    if (kind === "directory" ? !info.isDirectory() : !info.isFile()) throw new Error(`资源目标类型不符：${path}`);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

export function validateInstallPaths(paths: readonly string[]): void {
  validateResourcePaths(paths);
  if (paths.some((path) => normalizeResourcePath(path).split("/")[0]!.toLowerCase().startsWith(".wwt-"))) throw new Error("资源路径与助手工作目录冲突");
}

function parseJournal(value: unknown): Journal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("安装恢复记录格式无效");
  const row = value as Record<string, unknown>;
  if (row["version"] !== installJournalVersion || !["downloading", "installing", "committed"].includes(String(row["phase"])) || !Array.isArray(row["entries"])) throw new Error("安装恢复记录格式无效");
  for (const value of row["entries"]) {
    if (typeof value !== "object" || value === null) throw new Error("安装恢复条目无效");
    const entry = value as Record<string, unknown>;
    if (typeof entry["path"] !== "string" || typeof entry["hadOriginal"] !== "boolean" || typeof entry["replacing"] !== "boolean") throw new Error("安装恢复条目无效");
    if (entry["kind"] !== undefined && entry["kind"] !== "file" && entry["kind"] !== "directory") throw new Error("安装恢复目标类型无效");
    if (entry["remove"] !== undefined && entry["remove"] !== true) throw new Error("安装恢复删除标记无效");
  }
  const journal = value as Journal;
  validateInstallPaths(journal.entries.map((entry) => entry.path));
  if ((journal.phase === "downloading" && journal.entries.length) || (journal.phase === "committed" && journal.entries.some((entry) => !entry.replacing))) throw new Error("安装恢复阶段无效");
  return journal;
}

async function restore(root: string, directory: string, journal: Journal): Promise<void> {
  if (journal.phase !== "installing") return;
  for (const entry of [...journal.entries].reverse()) {
    if (!entry.replacing) continue;
    const target = join(root, entry.path);
    const backup = join(directory, "backup", entry.path);
    if (await existsEntry(backup, entry.kind)) {
      if (await existsEntry(target, entry.kind)) await rm(target, { recursive: entry.kind === "directory" });
      await mkdir(dirname(target), { recursive: true });
      await rename(backup, target);
    } else if (!entry.hadOriginal && (await existsEntry(target, entry.kind))) await rm(target, { recursive: entry.kind === "directory" });
  }
}

async function recover(root: string): Promise<number> {
  await ensureNoResourceSymlinks(root);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return 0;
    throw error;
  }
  let count = 0;
  for (const entry of entries.filter((item) => transactionName.test(item.name))) {
    const directory = join(root, entry.name);
    await ensureNoResourceSymlinks(directory);
    if (!entry.isDirectory()) throw new Error("安装恢复目录无效");
    let journal: Journal;
    try {
      journal = parseJournal(JSON.parse(await readFile(join(directory, "journal.json"), "utf8")) as unknown);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        // 初始记录尚未建立时，目录仅可能为空或含未提交的临时记录。
        const children = await readdir(directory);
        if (children.every((name) => /^journal-[\da-f-]+\.tmp$/.test(name))) {
          for (const name of children) await rm(join(directory, name));
          await rmdir(directory);
          count++;
          continue;
        }
      }
      throw new Error(`安装恢复记录无效，请保留备份目录：${directory}`);
    }
    // 完成标记已落盘时保留新版本；其余阶段恢复原文件后再清理暂存。
    await restore(root, directory, journal);
    await rm(directory, { recursive: true });
    count++;
  }
  return count;
}

export async function recoverResourceTransactions(rootDirectory: string): Promise<number> {
  const root = resolve(rootDirectory);
  const key = root.toLowerCase();
  if (activeRoots.has(key)) throw new Error("当前目录正在安装资源");
  const release = acquireProcessLock(root);
  activeRoots.add(key);
  try {
    return await recover(root);
  } finally {
    activeRoots.delete(key);
    release();
  }
}

export class ResourceTransaction {
  #journal: Journal = { version: installJournalVersion, phase: "downloading", entries: [] };
  readonly staging: string;
  #release: (() => void) | undefined;
  private constructor(
    readonly root: string,
    private readonly directory: string,
  ) {
    this.staging = join(directory, "staging");
  }
  get committed(): boolean {
    return this.#journal.phase === "committed";
  }

  static async begin(rootDirectory: string): Promise<ResourceTransaction> {
    const root = resolve(rootDirectory);
    const key = root.toLowerCase();
    if (activeRoots.has(key)) throw new Error("当前目录正在安装资源");
    const release = acquireProcessLock(root);
    activeRoots.add(key);
    try {
      await recover(root);
      const transaction = new ResourceTransaction(root, join(root, `.wwt-transaction-${randomUUID()}`));
      transaction.#release = release;
      await mkdir(transaction.directory, { recursive: true });
      await transaction.#save(transaction.#journal);
      await mkdir(transaction.staging, { recursive: true });
      return transaction;
    } catch (error) {
      activeRoots.delete(key);
      release();
      throw error;
    }
  }

  async #save(journal: Journal): Promise<void> {
    const path = join(this.directory, "journal.json");
    const temporary = join(this.directory, `journal-${randomUUID()}.tmp`);
    await ensureNoResourceSymlinks(path);
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(JSON.stringify(journal));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
    this.#journal = journal;
  }

  async install(paths: readonly string[], signal?: AbortSignal): Promise<void> {
    return this.installEntries(
      paths.map((path) => ({ path, kind: "file" })),
      signal,
    );
  }

  async installEntries(paths: readonly InstallEntry[], signal?: AbortSignal): Promise<void> {
    if (this.#journal.phase !== "downloading") throw new Error("安装事务已开始，不能重复提交");
    validateInstallPaths(paths.map((entry) => entry.path));
    const entries: Entry[] = [];
    for (const { path, kind, remove } of paths) {
      if (kind !== "file" && kind !== "directory") throw new Error("安装目标类型无效");
      if (!remove && !(await existsEntry(join(this.staging, path), kind))) throw new Error(`安装暂存目标缺失：${path}`);
      entries.push({
        path: normalizeResourcePath(path),
        kind,
        hadOriginal: await existsEntry(join(this.root, path), kind),
        replacing: false,
        ...(remove ? { remove: true } : {}),
      });
    }
    await this.#save({ version: installJournalVersion, phase: "installing", entries });
    for (let index = 0; index < entries.length; index++) {
      signal?.throwIfAborted();
      const entry = entries[index]!;
      const target = join(this.root, entry.path);
      const backup = join(this.directory, "backup", entry.path);
      // 替换意图必须先落盘，崩溃恢复才能识别 rename 两侧的任意中间状态。
      await this.#save({
        ...this.#journal,
        entries: this.#journal.entries.map((item, i) => (i === index ? { ...item, replacing: true } : item)),
      });
      await ensureNoResourceSymlinks(target);
      if (entry.hadOriginal) {
        await mkdir(dirname(backup), { recursive: true });
        await rename(target, backup);
      }
      if (!entry.remove) {
        await mkdir(dirname(target), { recursive: true });
        await rename(join(this.staging, entry.path), target);
      }
    }
    signal?.throwIfAborted();
    await this.#save({ ...this.#journal, phase: "committed" });
  }

  async finish(): Promise<void> {
    try {
      await restore(this.root, this.directory, this.#journal);
      await ensureNoResourceSymlinks(this.directory);
      await rm(this.directory, { recursive: true });
    } catch (error) {
      throw new Error(`安装恢复或清理失败，备份保存在：${this.directory}`, {
        cause: error,
      });
    } finally {
      activeRoots.delete(this.root.toLowerCase());
      this.#release?.();
    }
  }
}
