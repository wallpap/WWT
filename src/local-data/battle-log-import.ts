import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { validateGameExecutable } from "../game/launcher.ts";
import { decodeGameLog } from "../game/log-text.ts";
import { ensureNoResourceSymlinks } from "../game/resource-path.ts";
import { parseBattleLogLines, type BattleLogEvent } from "./battle-log.ts";
import { localArchiveStore, type LocalArchiveStore } from "./store.ts";

export interface BattleLogImportResult {
  scannedFiles: number;
  addedCount: number;
  duplicateCount: number;
}
export async function importBattleLogs(executablePath: string, store: Pick<LocalArchiveStore, "mergeLogEvents"> = localArchiveStore): Promise<BattleLogImportResult> {
  const directory = join(dirname(validateGameExecutable(executablePath)), "Client/Saved/Logs");
  await ensureNoResourceSymlinks(directory);
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && /^Client.*\.log$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const events: BattleLogEvent[] = [];
  // 每个日志独立识别登录，备份日志重叠的事件通过指纹去重。
  for (const name of names) {
    const path = join(directory, name);
    await ensureNoResourceSymlinks(path);
    const lines = decodeGameLog(await readFile(path)).split(/\r?\n/);
    events.push(...parseBattleLogLines(lines).events);
  }
  return {
    ...(await store.mergeLogEvents(events)),
    scannedFiles: names.length,
  };
}
