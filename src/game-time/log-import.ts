import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { GameTimeRecord } from "./model.ts";
import { parseGameLogLines } from "./log-parser.ts";
import { updateGameTimeRecords } from "./store.ts";
import { validateGameExecutable } from "../game/launcher.ts";
import { decodeGameLog } from "../game/log-text.ts";
import { millisecondsPerMinute } from "../units.ts";

export interface GameTimeLogImportResult {
  records: GameTimeRecord[];
  addedCount: number;
  updatedCount: number;
  scannedFiles: number;
}
function recordKey(record: GameTimeRecord): string {
  return JSON.stringify([record.roleId, record.gameDate, record.startTime, record.endTime]);
}

function sessionKey(record: GameTimeRecord): string {
  return JSON.stringify([record.roleId, record.gameDate, record.startTime]);
}

export function mergeGameTimeRecords(existing: readonly GameTimeRecord[], incoming: readonly GameTimeRecord[]): { records: GameTimeRecord[]; addedCount: number; updatedCount: number } {
  const records = [...existing];
  const seen = new Set(records.map(recordKey));
  // 来源标记区分可更新的日志会话与手工、历史记录。
  const sessions = new Map(records.flatMap((record, index) => (record.source === "log" ? [[sessionKey(record), index] as const] : [])));
  let nextId = records.reduce((max, record) => Math.max(max, record.id ?? 0), 0) + 1;
  let addedCount = 0;
  let updatedCount = 0;
  for (const record of incoming) {
    // 自动计时与日志描述相同区间时补全角色；无来源的手工记录保留。
    const automatic = records.findIndex((item) => item.source === "auto" && item.roleId === null && item.gameDate === record.gameDate && item.startTime === record.startTime && item.endTime === record.endTime);
    if (automatic >= 0) {
      const previous = records[automatic]!;
      records[automatic] = { ...record, id: previous.id!, source: "log" };
      sessions.set(sessionKey(record), automatic);
      seen.add(recordKey(record));
      updatedCount++;
      continue;
    }
    // 日志与进程计时的起止时间可能不同，保留自动记录中未被日志覆盖的区间。
    for (let i = records.length - 1; i >= 0; i--) {
      const previous = records[i]!;
      if (previous.source !== "auto" || previous.roleId !== null || previous.gameDate !== record.gameDate || previous.endTime <= record.startTime || previous.startTime >= record.endTime) continue;
      const remaining: GameTimeRecord[] = [];
      if (previous.startTime < record.startTime)
        remaining.push({
          ...previous,
          endTime: record.startTime,
          duration: record.startTime - previous.startTime,
        });
      if (previous.endTime > record.endTime)
        remaining.push({
          ...previous,
          id: remaining.length ? nextId++ : previous.id!,
          startTime: record.endTime,
          duration: previous.endTime - record.endTime,
        });
      records.splice(i, 1, ...remaining);
      updatedCount++;
    }
    sessions.clear();
    records.forEach((item, index) => {
      if (item.source === "log") sessions.set(sessionKey(item), index);
    });
    const session = sessionKey(record);
    const index = sessions.get(session);
    if (index !== undefined) {
      const previous = records[index]!;
      if (record.endTime > previous.endTime) {
        const extended = {
          ...previous,
          endTime: record.endTime,
          duration: record.endTime - previous.startTime,
        };
        records[index] = extended;
        seen.add(recordKey(extended));
        updatedCount += 1;
      }
      continue;
    }
    const key = recordKey(record);
    if (seen.has(key)) continue;
    seen.add(key);
    sessions.set(session, records.length);
    records.push({ ...record, id: nextId++, source: "log" });
    addedCount += 1;
  }
  return { records, addedCount, updatedCount };
}

export async function importGameTimeLogs(executablePath: string): Promise<GameTimeLogImportResult> {
  const normalizedPath = validateGameExecutable(executablePath);
  const logDirectory = join(dirname(normalizedPath), "Client", "Saved", "Logs");
  const entries = await readdir(logDirectory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.startsWith("Client") && entry.name.endsWith(".log"))
      .map(async (entry) => ({
        path: join(logDirectory, entry.name),
        modified: (await stat(join(logDirectory, entry.name))).mtimeMs,
      })),
  );
  files.sort((left, right) => left.modified - right.modified);

  const imported: GameTimeRecord[] = [];
  for (const file of files) {
    const lines = decodeGameLog(await readFile(file.path)).split(/\r?\n/);
    imported.push(...parseGameLogLines(lines, { minimumDuration: millisecondsPerMinute }));
  }
  return updateGameTimeRecords((records) => {
    const merged = mergeGameTimeRecords(records, imported);
    return {
      records: merged.addedCount > 0 || merged.updatedCount > 0 ? merged.records : records,
      result: { ...merged, scannedFiles: files.length },
    };
  });
}
