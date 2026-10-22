import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { OfficialResourceFile, OfficialResourceManifest } from "./official-resources.ts";
import { checkLocalResources } from "./resource-check.ts";
import { ensureNoResourceSymlinks } from "./resource-path.ts";
import { installOfficialResources, type ResourceUpdateOptions, type ResourceUpdateResult } from "./resource-update.ts";
import { recoverResourceTransactions } from "./resource-transaction.ts";
import { officialPatchTargets, sameResourceVersion } from "./official-patch.ts";
import { inspectLocalInstallation } from "./local-manifest.ts";
import { stageOfficialPatch } from "./resource-patch.ts";
import { ResourceDownloadCache } from "./resource-download.ts";

export async function installResourceManifest(root: string, files: readonly OfficialResourceFile[], manifest: OfficialResourceManifest, options: ResourceUpdateOptions = {}): Promise<ResourceUpdateResult> {
  options.signal?.throwIfAborted();
  if (manifest.predownload) throw new Error("预下载资源不能作为当前版本安装");
  await recoverResourceTransactions(root);
  const selected = new Set(files.map((file) => file.path.toLowerCase()));
  const entries = new Map(manifest.files.map((entry) => [entry.path, entry]));
  if (
    files.some((file) => {
      const entry = entries.get(file.path);
      return !entry || entry.size !== file.size || entry.md5 !== file.md5 || entry.url !== file.url;
    })
  )
    throw new Error("安装计划与官方清单不一致");
  const patch = manifest.patch;
  const targets = patch ? officialPatchTargets(patch, manifest.files) : manifest.files;
  const unchanged = targets.filter((file) => !selected.has(file.path.toLowerCase()));
  const totalBytes = unchanged.reduce((sum, file) => sum + file.size, 0);
  const report = (completedBytes: number, path: string) => {
    void options.onProgress?.({
      phase: "verify",
      path,
      completedFiles: 0,
      totalFiles: unchanged.length,
      completedBytes,
      totalBytes,
    });
  };
  report(0, "校验本地资源");
  const checked = await checkLocalResources(root, unchanged, {
    ...(options.signal ? { signal: options.signal } : {}),
    onProgress: report,
    reuseVerified: true,
  });
  if (checked.files.some((file) => file.state !== "valid" && file.state !== "unchecked")) throw new Error("本地资源已变化，请重新检查并生成安装计划");
  const configPath = join(root, "launcherDownloadConfig.json");
  await ensureNoResourceSymlinks(configPath);
  let config: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(await readFile(configPath, "utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("本地启动器配置格式无效");
    config = value as Record<string, unknown>;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const recorded = new Map((patch ? (await inspectLocalInstallation(join(root, "Wuthering Waves.exe"))).files : []).map((file) => [file.path.toLowerCase(), file]));
  for (const path of patch?.deleteFiles ?? []) recorded.delete(path.toLowerCase());
  for (const file of [...targets, ...files]) recorded.set(file.path.toLowerCase(), file);
  const metadata = new Map<string, string>([
    [
      "wwt-metadata:manifest",
      JSON.stringify(
        {
          resource: [...recorded.values()].map((file) => ({
            dest: file.path,
            size: file.size,
            md5: file.md5 ?? "",
          })),
        },
        null,
        2,
      ) + "\n",
    ],
    [
      "wwt-metadata:version",
      JSON.stringify(
        {
          ...config,
          version: manifest.version,
          state: "download_completed",
          isPreDownload: false,
        },
        null,
        2,
      ) + "\n",
    ],
  ]);
  const metadataFiles = [...metadata].map(([url, body], index) => ({
    path: index === 0 ? "LocalGameResources.json" : "launcherDownloadConfig.json",
    url,
    size: Buffer.byteLength(body),
    md5: createHash("md5").update(body).digest("hex"),
  }));
  if (patch && (typeof config["version"] !== "string" || !sameResourceVersion(config["version"], patch.fromVersion))) throw new Error("本地版本已变化，请重新检查更新");
  let patchFallback = false;
  const fetcher = options.fetcher ?? fetch;
  const result = await installOfficialResources(
    root,
    [...files, ...metadataFiles],
    {
      ...options,
      downloadCache: options.downloadCache ?? join(root, ".wwt-download-cache"),
      fetcher: (input, init) => {
        const body = metadata.get(String(input));
        return body === undefined ? fetcher(input, init) : Promise.resolve(new Response(body));
      },
    },
    patch
      ? {
          deletePaths: patch.deleteFiles,
          stage: async (directory, cache) => {
            const result = await stageOfficialPatch(root, directory, patch, files, cache, options);
            patchFallback = result.fallback;
            return result.prepared;
          },
        }
      : undefined,
  );
  let notice = [result.notice, patchFallback ? "部分差分执行或校验失败，已下载完整文件完成更新" : ""].filter(Boolean).join("；");
  if (patch) {
    try {
      const cache = new ResourceDownloadCache(options.downloadCache ?? join(root, ".wwt-download-cache"));
      for (const file of patch.files) await cache.discard(file);
    } catch {
      notice = [notice, "更新已完成，部分差分缓存未能清理"].filter(Boolean).join("；");
    }
  }
  const predownloadRecord = join(root, ".wwt-predownload.json");
  try {
    await ensureNoResourceSymlinks(predownloadRecord);
    const value = JSON.parse(await readFile(predownloadRecord, "utf8")) as unknown;
    if (typeof value === "object" && value !== null && "version" in value && "source" in value && value.version === manifest.version && value.source === manifest.source) await rm(predownloadRecord);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) notice = [notice, "资源已安装，预下载记录未能清理"].filter(Boolean).join("；");
  }
  return {
    installedFiles: files.length,
    installedBytes: files.reduce((sum, file) => sum + file.size, 0),
    ...(notice ? { notice } : {}),
  };
}
