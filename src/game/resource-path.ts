import { lstat } from "node:fs/promises";
import { join, parse, resolve } from "node:path";

export function normalizeResourcePath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error(`资源清单包含不安全路径：${path}`);
  }
  return normalized;
}

export function validateResourcePaths(paths: readonly string[]): void {
  const seen = new Set<string>();
  const normalized = paths.map((path) => normalizeResourcePath(path).toLowerCase());
  for (const path of normalized) {
    if (seen.has(path)) throw new Error(`资源清单包含重复路径：${path}`);
    seen.add(path);
  }
  for (const path of normalized) {
    const parts = path.split("/");
    parts.pop();
    while (parts.length > 0) {
      if (seen.has(parts.join("/"))) throw new Error(`资源文件与目录路径冲突：${path}`);
      parts.pop();
    }
  }
}

// Windows 的目录联接也会被 lstat 标记为符号链接，必须逐层检查。
export async function ensureNoResourceSymlinks(path: string): Promise<void> {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(/[\\/]/)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`拒绝访问符号链接：${current}`);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
  }
}
