import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { appPaths } from "./app-paths.ts";
import { bytesPerMebibyte } from "../units.ts";

const maxDiagnosticLogBytes = 2 * bytesPerMebibyte;

// 仅接受诊断元数据，避免异常正文、凭据和业务响应进入日志。
export function diagnostic(
  event: string,
  fields: {
    path?: string;
    method?: string;
    stage?: string;
    status?: number;
    code?: number;
    elapsedMs?: number;
    resources?: boolean;
    server?: boolean;
    updater?: boolean;
    autoSign?: boolean;
  } = {},
): void {
  try {
    const directory = join(appPaths.dataDirectory, "logs");
    mkdirSync(directory, { recursive: true });
    const path = join(directory, "runtime.log");
    try {
      if (statSync(path).size >= maxDiagnosticLogBytes) renameSync(path, `${path}.previous`);
    } catch {}
    appendFileSync(
      path,
      JSON.stringify({
        time: new Date().toISOString(),
        pid: process.pid,
        event,
        ...fields,
      }) + "\n",
      "utf8",
    );
  } catch {
    /* 日志写入失败不阻断业务。 */
  }
}
