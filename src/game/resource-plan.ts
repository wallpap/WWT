import type { LocalResourceFile } from "./local-manifest.ts";
import type { OfficialResourceFile } from "./official-resources.ts";
import { checkLocalResources } from "./resource-check.ts";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { ensureNoResourceSymlinks, normalizeResourcePath } from "./resource-path.ts";
import { officialPatchTargets, type OfficialResourcePatch } from "./official-patch.ts";

export type ResourcePlanAction = "download" | "replace" | "unchanged";

export interface ResourcePlanEntry {
  path: string;
  size: number;
  md5: string | null;
  action: ResourcePlanAction;
}

export interface ResourcePlan {
  entries: ResourcePlanEntry[];
  downloadCount: number;
  replaceCount: number;
  unchangedCount: number;
  totalBytes: number;
  extraLocalCount: number;
}

function sameFile(local: LocalResourceFile, official: OfficialResourceFile): boolean {
  if (local.size !== official.size) return false;
  if (local.md5 !== null && official.md5 !== null) return local.md5.toLowerCase() === official.md5.toLowerCase();
  return local.md5 === null && official.md5 === null && local.size === official.size;
}

export function planResourceUpdate(local: readonly LocalResourceFile[], official: readonly OfficialResourceFile[]): ResourcePlan {
  const localByPath = new Map(local.map((file) => [file.path.toLocaleLowerCase("en-US"), file]));
  const officialPaths = new Set(official.map((file) => file.path.toLocaleLowerCase("en-US")));
  const entries = official.map((file) => {
    const previous = localByPath.get(file.path.toLocaleLowerCase("en-US"));
    const action: ResourcePlanAction = previous === undefined ? "download" : sameFile(previous, file) ? "unchanged" : "replace";
    return { path: file.path, size: file.size, md5: file.md5, action };
  });
  return {
    entries,
    downloadCount: entries.filter((entry) => entry.action === "download").length,
    replaceCount: entries.filter((entry) => entry.action === "replace").length,
    unchangedCount: entries.filter((entry) => entry.action === "unchanged").length,
    totalBytes: entries.filter((entry) => entry.action !== "unchanged").reduce((total, entry) => total + entry.size, 0),
    extraLocalCount: local.filter((file) => !officialPaths.has(file.path.toLocaleLowerCase("en-US"))).length,
  };
}

export async function planInstalledResourceUpdate(root: string, local: readonly LocalResourceFile[], official: readonly OfficialResourceFile[]): Promise<ResourcePlan> {
  const checked = await checkLocalResources(root, official);
  const actual = checked.files.flatMap((file): LocalResourceFile[] =>
    file.actualSize === null
      ? []
      : [
          {
            path: file.path,
            size: file.actualSize,
            md5: file.actualMd5,
            url: "",
          },
        ],
  );
  const officialPaths = new Set(official.map((file) => file.path.toLowerCase()));
  return planResourceUpdate([...local.filter((file) => !officialPaths.has(file.path.toLowerCase())), ...actual], official);
}

export async function planGameResourceUpdate(root: string, local: readonly LocalResourceFile[], official: readonly OfficialResourceFile[], patch?: OfficialResourcePatch): Promise<ResourcePlan> {
  // 原版资源记录可能不完整；增量更新范围由官方补丁决定。
  const targets = patch ? officialPatchTargets(patch, official) : official;
  const recorded = new Map(local.map((file) => [file.path.toLowerCase(), file]));
  const actual: LocalResourceFile[] = [];
  for (const file of targets) {
    const path = join(root, normalizeResourcePath(file.path));
    await ensureNoResourceSymlinks(path);
    try {
      const info = await stat(path);
      if (!info.isFile()) continue;
      const previous = recorded.get(file.path.toLowerCase());
      actual.push({
        path: file.path,
        size: info.size,
        md5: previous?.size === info.size ? previous.md5 : null,
        url: "",
      });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  return planResourceUpdate(actual, targets);
}
