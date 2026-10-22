import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { OfficialResourceFile } from "./official-resources.ts";
import type { OfficialResourcePatch } from "./official-patch.ts";
import type { ResourceUpdateOptions } from "./resource-update.ts";
import { applyHpatchz } from "./hpatchz.ts";
import { checkLocalResources } from "./resource-check.ts";
import { downloadResourceFiles } from "./resource-download-task.ts";
import type { ResourceDownloadCache } from "./resource-download.ts";
import { planPatchDownloads } from "./resource-patch-plan.ts";

export async function stageOfficialPatch(root: string, staging: string, patch: OfficialResourcePatch, pending: readonly OfficialResourceFile[], cache: ResourceDownloadCache, options: ResourceUpdateOptions): Promise<{ prepared: ReadonlySet<string>; fallback: boolean }> {
  const plan = planPatchDownloads(patch, pending);
  const prepared = new Set<string>();
  const cached = new Map<string, string>();
  let fallback = false;
  try {
    await downloadResourceFiles(plan.files, cache, options, async (file, path) => {
      cached.set(file.path.toLowerCase(), path);
    });
  } catch {
    options.signal?.throwIfAborted();
    return { prepared, fallback: true };
  }
  const final = new Map(pending.map((file) => [file.path.toLowerCase(), file]));
  const patchPaths = new Set(plan.groups.map((group) => group.patchPath.toLowerCase()));
  for (const file of plan.files.filter((file) => !patchPaths.has(file.path.toLowerCase()))) {
    const destination = final.get(file.path.toLowerCase());
    if (!destination || destination.size !== file.size || destination.md5 !== file.md5) continue;
    const target = join(staging, destination.path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(cached.get(file.path.toLowerCase())!, target);
    prepared.add(destination.path.toLowerCase());
  }
  for (const [index, group] of plan.groups.entries()) {
    options.signal?.throwIfAborted();
    const directory = join(staging, `.wwt-patch-${index}`);
    try {
      await options.onProgress?.({
        phase: "patch",
        path: group.patchPath,
        totalFiles: plan.groups.length,
        completedFiles: index,
        totalBytes: 0,
        completedBytes: 0,
      });
      await applyHpatchz(root, cached.get(group.patchPath.toLowerCase())!, directory, options.signal);
      const outputs = group.files.flatMap((file) => {
        const target = final.get(file.path.toLowerCase());
        return target && target.md5 && !prepared.has(target.path.toLowerCase()) ? [target] : [];
      });
      await options.onProgress?.({
        phase: "verify",
        path: group.patchPath,
        totalFiles: outputs.length,
        completedFiles: 0,
        totalBytes: 0,
        completedBytes: 0,
      });
      const checked = await checkLocalResources(directory, outputs);
      for (const file of outputs) {
        options.signal?.throwIfAborted();
        if (!checked.files.some((check) => check.path === file.path && check.state === "valid")) {
          fallback = true;
          continue;
        }
        const target = join(staging, file.path);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(join(directory, file.path), target);
        prepared.add(file.path.toLowerCase());
      }
    } catch {
      options.signal?.throwIfAborted();
      fallback = true;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  return { prepared, fallback };
}
