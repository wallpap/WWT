import { copyFile, lstat, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { OfficialResourceFile } from "./official-resources.ts";
import { ensureNoResourceSymlinks, normalizeResourcePath } from "./resource-path.ts";
import { ResourceTransaction, validateInstallPaths } from "./resource-transaction.ts";
import { ResourceDownloadCache } from "./resource-download.ts";
import { validateDownloadPolicy } from "./download-policy.ts";
import { downloadResourceFiles } from "./resource-download-task.ts";

export interface ResourceUpdateProgress {
  phase?: "download" | "patch" | "verify" | "install";
  path: string;
  completedFiles: number;
  totalFiles: number;
  completedBytes: number;
  totalBytes: number;
}

export interface ResourceUpdateResult {
  installedFiles: number;
  installedBytes: number;
  notice?: string;
}

export interface ResourceUpdateOptions {
  signal?: AbortSignal;
  beforeCommit?: () => Promise<void>;
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onProgress?: (progress: ResourceUpdateProgress) => void | Promise<void>;
  downloadCache?: string;
  parallel?: number;
  bytesPerSecond?: number;
}

function targetPath(root: string, path: string): string {
  return join(root, normalizeResourcePath(path));
}

async function checkTarget(path: string): Promise<void> {
  await ensureNoResourceSymlinks(path);
  try {
    if (!(await lstat(path)).isFile()) throw new Error(`资源目标不是普通文件：${path}`);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}

export async function installOfficialResources(
  rootDirectory: string,
  files: readonly OfficialResourceFile[],
  options: ResourceUpdateOptions = {},
  preparation?: {
    stage: (directory: string, cache: ResourceDownloadCache) => Promise<ReadonlySet<string>>;
    deletePaths: readonly string[];
  },
): Promise<ResourceUpdateResult> {
  if (files.length === 0) throw new Error("没有可安装的资源文件");
  options.signal?.throwIfAborted();
  validateInstallPaths([...files.map((file) => file.path), ...(preparation?.deletePaths ?? [])]);
  validateDownloadPolicy({
    parallel: options.parallel ?? 1,
    bytesPerSecond: options.bytesPerSecond ?? 0,
  });
  const root = resolve(rootDirectory);
  await ensureNoResourceSymlinks(root);
  for (const file of files) {
    if (!Number.isSafeInteger(file.size) || file.size < 0) throw new Error(`资源大小无效：${file.path}`);
    await checkTarget(targetPath(root, file.path));
  }
  const transaction = await ResourceTransaction.begin(root);
  const cache = new ResourceDownloadCache(options.downloadCache ?? join(transaction.staging, ".wwt-download-cache"));
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  let notice: string | undefined;
  try {
    const prepared = (await preparation?.stage(transaction.staging, cache)) ?? new Set<string>();
    await downloadResourceFiles(
      files.filter((file) => !prepared.has(file.path.toLowerCase())),
      cache,
      options,
      async (file, cached) => {
        const staged = targetPath(transaction.staging, file.path);
        await mkdir(dirname(staged), { recursive: true });
        await copyFile(cached, staged);
      },
    );
    await options.beforeCommit?.();
    options.signal?.throwIfAborted();
    await transaction.installEntries(
      [
        ...files.map((file) => ({ path: file.path, kind: "file" as const })),
        ...(preparation?.deletePaths ?? []).map((path) => ({
          path,
          kind: "file" as const,
          remove: true,
        })),
      ],
      options.signal,
    );
  } finally {
    try {
      await transaction.finish();
    } catch (error) {
      if (!transaction.committed) throw error;
      notice = error instanceof Error ? error.message : "资源已安装，备份目录清理失败";
    }
  }
  try {
    if (options.downloadCache) for (const file of files) await cache.discard(file);
  } catch {
    notice = [notice, "资源已安装，部分下载缓存未能清理"].filter(Boolean).join("；");
  }
  return {
    installedFiles: files.length,
    installedBytes: totalBytes,
    ...(notice ? { notice } : {}),
  };
}
