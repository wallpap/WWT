import { lstat, readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { ensureNoResourceSymlinks, normalizeResourcePath, validateResourcePaths } from "./resource-path.ts";

const manifestNames = ["LocalGameResources.json", "gameResources.json", "OriginResource.json", "resource-manifest.json", "manifest.json"] as const;

export interface LocalResourceFile {
  path: string;
  size: number;
  md5: string | null;
  url: string;
}

export interface LocalInstallationInfo {
  rootDirectory: string;
  version: string | null;
  executableExists: boolean;
  state: string | null;
  manifestPath: string | null;
  files: LocalResourceFile[];
  totalBytes: number;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("资源清单 JSON 结构无效");
  return value as Record<string, unknown>;
}

function validateFiles(value: unknown): LocalResourceFile[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("资源清单为空或格式无效");
  const files = value.map((item) => {
    const record = objectValue(item);
    const rawPath = typeof record["path"] === "string" ? record["path"] : record["dest"];
    if (typeof rawPath !== "string" || !rawPath.trim()) throw new Error("资源清单包含无效文件路径");
    const path = normalizeResourcePath(rawPath);
    const size = record["size"];
    const md5 = record["md5"];
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) throw new Error(`资源大小无效：${path}`);
    if (md5 !== undefined && md5 !== null && md5 !== "" && (typeof md5 !== "string" || !/^[a-f\d]{32}$/i.test(md5))) {
      throw new Error(`资源 MD5 格式无效：${path}`);
    }
    return {
      path,
      size,
      md5: typeof md5 === "string" && md5 ? md5.toLowerCase() : null,
      url: typeof record["url"] === "string" ? record["url"] : "",
    };
  });
  validateResourcePaths(files.map((file) => file.path));
  return files;
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(pathFromRoot);
}

export async function inspectLocalInstallation(executablePath: string): Promise<LocalInstallationInfo> {
  const executable = executablePath.trim();
  if (!isAbsolute(executable) || extname(executable).toLowerCase() !== ".exe") throw new Error("请填写游戏主程序的完整 EXE 路径");
  const rootDirectory = resolve(dirname(executable));
  if (dirname(rootDirectory) === rootDirectory) throw new Error("请使用独立的游戏安装目录");
  await ensureNoResourceSymlinks(executable);
  let executableExists = false;
  try {
    if (!(await lstat(executable)).isFile()) throw new Error("游戏主程序路径不是普通文件");
    executableExists = true;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  let version: string | null = null;
  let state: string | null = null;
  try {
    const configPath = join(rootDirectory, "launcherDownloadConfig.json");
    await ensureNoResourceSymlinks(configPath);
    const config = objectValue(JSON.parse(await readFile(configPath, "utf8")) as unknown);
    version = typeof config["version"] === "string" && config["version"].trim() ? config["version"] : null;
    state = typeof config["state"] === "string" ? config["state"] : null;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }

  for (const name of manifestNames) {
    const manifestPath = join(rootDirectory, name);
    await ensureNoResourceSymlinks(manifestPath);
    let contents: string;
    try {
      contents = await readFile(manifestPath, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
    const canonicalPath = resolve(manifestPath);
    if (!isWithin(rootDirectory, canonicalPath)) throw new Error("资源清单路径超出游戏目录");
    const parsed: unknown = JSON.parse(contents.replace(/^\uFEFF/, ""));
    const root = objectValue(parsed);
    const files = validateFiles(Array.isArray(root["files"]) ? root["files"] : objectValue(parsed)["resource"]);
    return {
      rootDirectory,
      version,
      executableExists,
      state,
      manifestPath: canonicalPath,
      files,
      totalBytes: files.reduce((total, file) => total + file.size, 0),
    };
  }
  return {
    rootDirectory,
    version,
    executableExists,
    state,
    manifestPath: null,
    files: [],
    totalBytes: 0,
  };
}
