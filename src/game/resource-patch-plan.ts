import type { OfficialResourceFile } from "./official-resources.ts";
import type { OfficialResourcePatch } from "./official-patch.ts";

export function planPatchDownloads(
  patch: OfficialResourcePatch,
  pending: readonly OfficialResourceFile[],
): {
  files: OfficialResourceFile[];
  groups: OfficialResourcePatch["groups"];
  downloads: OfficialResourceFile[];
  totalBytes: number;
} {
  const selected = new Set(pending.map((file) => file.path.toLowerCase()));
  const groups = patch.groups.filter((group) => {
    const cost = patch.files.find((file) => file.path.toLowerCase() === group.patchPath.toLowerCase())!.size;
    return group.files.filter((file) => selected.has(file.path.toLowerCase())).reduce((sum, file) => sum + file.size, 0) > cost;
  });
  const patches = new Set(groups.map((group) => group.patchPath.toLowerCase()));
  const allPatches = new Set(patch.groups.map((group) => group.patchPath.toLowerCase()));
  const files = patch.files.filter((file) => patches.has(file.path.toLowerCase()) || (selected.has(file.path.toLowerCase()) && !allPatches.has(file.path.toLowerCase())));
  const covered = new Set([...groups.flatMap((group) => group.files), ...files].map((file) => file.path.toLowerCase()));
  const downloads = [...files, ...pending.filter((file) => !covered.has(file.path.toLowerCase()))];
  return {
    files,
    groups,
    downloads,
    totalBytes: downloads.reduce((sum, file) => sum + file.size, 0),
  };
}
