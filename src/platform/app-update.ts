import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import helperSource from "./app-update-helper.ps1" with { type: "text" };
import { ensureNoResourceSymlinks, normalizeResourcePath, validateResourcePaths } from "../game/resource-path.ts";
import { millisecondsPerSecond } from "../units.ts";

const maxAppUpdateDiagnosticsLength = 4_096;
const appUpdateWorkerReadyTimeoutMs = 15 * millisecondsPerSecond;
const appUpdateWorkerPollIntervalMs = 50;

export interface PreparedAppFile {
  path: string;
  sha256: string;
}
const loader = "& ([ScriptBlock]::Create([IO.File]::ReadAllText($env:WWT_UPDATE_SCRIPT)))";
async function helperPath(workspace: string): Promise<string> {
  const path = join(workspace, "update-helper.ps1");
  await ensureNoResourceSymlinks(path);
  await writeFile(path, String(helperSource), "utf8");
  return path;
}
function command(): string[] {
  return ["powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", Buffer.from(loader, "utf16le").toString("base64")];
}
export async function extractAppUpdate(archive: string, workspace: string, folder: string, signal?: AbortSignal): Promise<PreparedAppFile[]> {
  signal?.throwIfAborted();
  await ensureNoResourceSymlinks(workspace);
  await mkdir(workspace, { recursive: true });
  const script = await helperPath(workspace);
  const child = Bun.spawn(command(), {
    env: {
      ...process.env,
      WWT_UPDATE_SCRIPT: script,
      WWT_UPDATE_MODE: "extract",
      WWT_UPDATE_ARCHIVE: resolve(archive),
      WWT_UPDATE_STAGING: join(workspace, "package"),
      WWT_UPDATE_FOLDER: folder,
    },
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const abort = () => {
    child.kill();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) abort();
    const [output, diagnostics, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    signal?.throwIfAborted();
    if (code !== 0)
      throw new Error(`应用更新包解压或检查失败（退出码 ${code}）`, {
        cause: new Error(diagnostics.slice(0, maxAppUpdateDiagnosticsLength)),
      });
    const value: unknown = JSON.parse(output.replace(/^\uFEFF/, ""));
    if (typeof value !== "object" || value === null || !("files" in value) || !Array.isArray(value.files)) throw new Error("应用更新包文件列表无效");
    const files = value.files.map((file: unknown): PreparedAppFile => {
      if (typeof file !== "object" || file === null || !("path" in file) || typeof file.path !== "string" || !("sha256" in file) || typeof file.sha256 !== "string" || !/^[a-f\d]{64}$/.test(file.sha256)) throw new Error("应用更新文件校验值无效");
      return { path: normalizeResourcePath(file.path), sha256: file.sha256 };
    });
    validateResourcePaths(files.map((file) => file.path));
    return files;
  } finally {
    signal?.removeEventListener("abort", abort);
    await child.exited;
  }
}
export async function startAppUpdateWorker(planPath: string): Promise<void> {
  const directory = dirname(resolve(planPath));
  const script = await helperPath(directory);
  // 失败后重试时，旧标记不能替代新安装器的就绪确认。
  // 独立入口与安装工作区一起保留，主程序缺失时仍可回滚。
  const recovery = '@echo off\r\nset "WWT_UPDATE_MODE=recover"\r\nset "WWT_UPDATE_PLAN=%~dp0plan.json"\r\nset "WWT_UPDATE_SCRIPT=%~dp0update-helper.ps1"\r\npowershell.exe -NoProfile -NonInteractive -Command "& ([ScriptBlock]::Create([IO.File]::ReadAllText($env:WWT_UPDATE_SCRIPT)))"\r\nif errorlevel 1 pause\r\n';
  const recoveryPath = join(directory, "recover.cmd");
  await ensureNoResourceSymlinks(recoveryPath);
  await writeFile(recoveryPath, recovery, "utf8");
  const ready = join(directory, "ready");
  await ensureNoResourceSymlinks(ready);
  await rm(ready, { force: true });
  const child = Bun.spawn(command(), {
    env: {
      ...process.env,
      WWT_UPDATE_SCRIPT: script,
      WWT_UPDATE_MODE: "apply",
      WWT_UPDATE_PLAN: resolve(planPath),
    },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    windowsHide: true,
  });
  let exited = false;
  void child.exited.then(() => {
    exited = true;
  });
  const deadline = Date.now() + appUpdateWorkerReadyTimeoutMs;
  while (Date.now() < deadline) {
    if (exited) throw new Error("应用更新安装器未能准备完成，保留当前版本");
    if (await Bun.file(ready).exists()) {
      child.unref();
      return;
    }
    await Bun.sleep(appUpdateWorkerPollIntervalMs);
  }
  child.kill();
  await child.exited;
  throw new Error("应用更新安装器准备超时");
}
