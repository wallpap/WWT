import { lstat, readdir, readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { validateGameExecutable } from "./launcher.ts";
import { ensureNoResourceSymlinks, normalizeResourcePath } from "./resource-path.ts";
import { bytesPerMebibyte } from "../units.ts";

const screenshotPreviewLimitBytes = 64 * bytesPerMebibyte;
const imageSignature = {
  png: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  jpeg: Buffer.from([255, 216, 255]),
  riff: Buffer.from("RIFF"),
  webp: Buffer.from("WEBP"),
} as const;
const webpFormatOffset = imageSignature.riff.length + 4;

export interface GameScreenshot {
  path: string;
  name: string;
  size: number;
  modifiedAt: number;
}
const formats = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const roots = ["ScreenShot", "Screenshots"];
function savedDirectory(executable: string): string {
  return join(dirname(validateGameExecutable(executable)), "Client/Saved");
}
async function isDirectory(path: string): Promise<boolean> {
  await ensureNoResourceSymlinks(path);
  try {
    return (await lstat(path)).isDirectory();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
export async function screenshotDirectory(executable: string): Promise<string> {
  const saved = savedDirectory(executable);
  for (const name of roots) if (await isDirectory(join(saved, name))) return join(saved, name);
  throw new Error("当前游戏尚未创建截图目录");
}
export async function listGameScreenshots(executable: string): Promise<GameScreenshot[]> {
  const saved = savedDirectory(executable);
  const files: GameScreenshot[] = [];
  async function walk(relative: string): Promise<void> {
    const directory = join(saved, relative);
    await ensureNoResourceSymlinks(directory);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && formats.has(extname(entry.name).toLowerCase())) {
        const information = await lstat(join(saved, path));
        files.push({
          path: normalizeResourcePath(path),
          name: entry.name,
          size: information.size,
          modifiedAt: information.mtimeMs,
        });
      }
    }
  }
  for (const name of roots) if (await isDirectory(join(saved, name))) await walk(name);
  return files.sort((a, b) => b.modifiedAt - a.modifiedAt || a.path.localeCompare(b.path));
}
export async function gameScreenshotPath(executable: string, path: string): Promise<string> {
  const normalized = normalizeResourcePath(path);
  if (!roots.some((name) => normalized.split("/")[0]!.toLowerCase() === name.toLowerCase()) || !formats.has(extname(normalized).toLowerCase())) throw new Error("截图路径无效");
  const target = join(savedDirectory(executable), normalized);
  await ensureNoResourceSymlinks(target);
  if (!(await lstat(target)).isFile()) throw new Error("截图文件不存在");
  return target;
}
export async function readGameScreenshot(executable: string, path: string): Promise<string> {
  const target = await gameScreenshotPath(executable, path);
  if ((await lstat(target)).size > screenshotPreviewLimitBytes) throw new Error("截图超过预览大小限制，请使用系统查看器打开");
  const bytes = await readFile(target);
  const mime = bytes.subarray(0, imageSignature.png.length).equals(imageSignature.png)
    ? "image/png"
    : bytes.subarray(0, imageSignature.jpeg.length).equals(imageSignature.jpeg)
      ? "image/jpeg"
      : bytes.subarray(0, imageSignature.riff.length).equals(imageSignature.riff) && bytes.subarray(webpFormatOffset, webpFormatOffset + imageSignature.webp.length).equals(imageSignature.webp)
        ? "image/webp"
        : null;
  if (!mime) throw new Error("截图图像格式无效");
  return `data:${mime};base64,${bytes.toString("base64")}`;
}
