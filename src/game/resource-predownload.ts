import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { OfficialResourceFile, OfficialResourceManifest } from "./official-resources.ts";
import type { ResourceUpdateOptions, ResourceUpdateResult } from "./resource-update.ts";
import { ResourceDownloadCache } from "./resource-download.ts";
import { downloadResourceFiles } from "./resource-download-task.ts";
import { ensureNoResourceSymlinks } from "./resource-path.ts";
import { validateInstallPaths } from "./resource-transaction.ts";
import { planPatchDownloads } from "./resource-patch-plan.ts";

export async function predownloadResources(rootDirectory: string, files: readonly OfficialResourceFile[], manifest: OfficialResourceManifest, options: ResourceUpdateOptions = {}): Promise<ResourceUpdateResult> {
  if (!manifest.predownload) throw new Error("请选择官方预下载清单");
  if (!files.length) throw new Error("没有需要预下载的资源");
  validateInstallPaths(files.map((file) => file.path));
  if (files.some((file) => !manifest.files.some((item) => item.path === file.path && item.size === file.size && item.md5 === file.md5 && item.url === file.url))) throw new Error("预下载计划与官方清单不一致");
  const root = resolve(rootDirectory);
  await ensureNoResourceSymlinks(root);
  await mkdir(root, { recursive: true });
  const cache = new ResourceDownloadCache(options.downloadCache ?? join(root, ".wwt-download-cache"));
  const downloads = manifest.patch ? planPatchDownloads(manifest.patch, files).downloads : files;
  await downloadResourceFiles(downloads, cache, options);
  options.signal?.throwIfAborted();
  const record = join(root, ".wwt-predownload.json");
  const temporary = `${record}.${crypto.randomUUID()}.tmp`;
  await ensureNoResourceSymlinks(record);
  try {
    await writeFile(
      temporary,
      JSON.stringify({
        source: manifest.source,
        version: manifest.version,
        updatedAt: Date.now(),
        files: downloads.map(({ path, size, md5 }) => ({ path, size, md5 })),
      }),
      { flag: "wx" },
    );
    await rename(temporary, record);
  } finally {
    await rm(temporary, { force: true });
  }
  return { installedFiles: 0, installedBytes: 0 };
}
