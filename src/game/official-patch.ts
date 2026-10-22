import type { OfficialResourceFile } from "./official-resources.ts";
import { normalizeResourcePath } from "./resource-path.ts";
import { validateInstallPaths } from "./resource-transaction.ts";

export interface OfficialPatchGroup {
  patchPath: string;
  files: OfficialResourceFile[];
}
export interface OfficialResourcePatch {
  fromVersion: string;
  files: OfficialResourceFile[];
  groups: OfficialPatchGroup[];
  deleteFiles: string[];
}

export function sameResourceVersion(left: string, right: string): boolean {
  const normalize = (value: string) =>
    /^\d+(?:\.\d+)*$/.test(value.trim())
      ? value
          .trim()
          .split(".")
          .map((part) => BigInt(part).toString())
          .join(".")
          .replace(/(?:\.0)+$/, "")
      : value.trim();
  return normalize(left) === normalize(right);
}

export function officialPatchTargets(patch: OfficialResourcePatch, full: readonly OfficialResourceFile[]): OfficialResourceFile[] {
  const paths = new Set([...patch.files, ...patch.groups.flatMap((group) => group.files)].map((file) => file.path.toLowerCase()));
  return full.filter((file) => paths.has(file.path.toLowerCase()));
}

export function parseOfficialPatch(value: unknown, fromVersion: string, files: OfficialResourceFile[], full: readonly OfficialResourceFile[]): OfficialResourcePatch {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("官方差分索引无效");
  const index = value as Record<string, unknown>;
  const final = new Map(full.map((file) => [file.path.toLowerCase(), file]));
  const groups: OfficialPatchGroup[] = [];
  const obsoleteSources: string[] = [];
  if (index["patchInfos"] !== undefined && !Array.isArray(index["patchInfos"])) throw new Error("官方差分条目无效");
  if (index["groupInfos"] !== undefined && !Array.isArray(index["groupInfos"])) throw new Error("官方分组差分条目无效");
  const rawGroups = ((index["groupInfos"] as unknown[] | undefined)?.length ? index["groupInfos"] : index["patchInfos"]) ?? [];
  for (const item of rawGroups as unknown[]) {
    const raw = typeof item === "object" && item !== null && "dstFiles" in item ? { ...item, entries: item.dstFiles } : item;
    if (typeof raw !== "object" || raw === null || !("dest" in raw) || typeof raw.dest !== "string" || !("entries" in raw) || !Array.isArray(raw.entries)) throw new Error("官方差分目标无效");
    const patchPath = normalizeResourcePath(raw.dest);
    if (!files.some((file) => file.path.toLowerCase() === patchPath.toLowerCase() && file.md5 !== null)) throw new Error("官方差分包缺少下载条目或校验值");
    const paths = raw.entries.map((entry: unknown) => {
      if (typeof entry !== "object" || entry === null || !("dest" in entry) || typeof entry.dest !== "string") throw new Error("官方差分输出路径无效");
      return normalizeResourcePath(entry.dest);
    });
    validateInstallPaths(paths);
    groups.push({
      patchPath,
      files: paths.flatMap((path) => {
        const file = final.get(path.toLowerCase());
        return file ? [file] : [];
      }),
    });
    if (typeof item === "object" && item !== null && "srcFiles" in item) {
      if (!Array.isArray(item.srcFiles)) throw new Error("官方分组差分来源无效");
      const sources = item.srcFiles.map((entry: unknown) => {
        if (typeof entry !== "object" || entry === null || !("dest" in entry) || typeof entry.dest !== "string") throw new Error("官方分组差分来源路径无效");
        return normalizeResourcePath(entry.dest);
      });
      validateInstallPaths(sources);
      obsoleteSources.push(...sources.filter((path) => !final.has(path.toLowerCase())));
    }
  }
  validateInstallPaths(files.map((file) => file.path));
  validateInstallPaths(groups.map((group) => group.patchPath));
  const rawDeletes = index["deleteFiles"] ?? [];
  if (!Array.isArray(rawDeletes) || rawDeletes.some((path) => typeof path !== "string")) throw new Error("官方差分删除列表无效");
  const deleteFiles = [...new Map([...(rawDeletes as string[]).map(normalizeResourcePath), ...obsoleteSources].map((path) => [path.toLowerCase(), path])).values()];
  validateInstallPaths([...full.map((file) => file.path), ...deleteFiles, "LocalGameResources.json", "launcherDownloadConfig.json"]);
  for (const file of files.filter((file) => !groups.some((group) => group.patchPath.toLowerCase() === file.path.toLowerCase()))) {
    const target = final.get(file.path.toLowerCase());
    if (!target || target.md5 !== file.md5 || target.size !== file.size) throw new Error("差分替换文件与完整清单不一致");
  }
  return { fromVersion, files, groups, deleteFiles };
}
