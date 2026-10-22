import type { GameTimeRecord } from "./model.ts";
import { updateGameTimeRecords } from "./store.ts";

export function mergeImportedGameTime(existing: readonly GameTimeRecord[], incoming: readonly GameTimeRecord[]) {
  const records = [...existing];
  const key = (record: GameTimeRecord): string => JSON.stringify([record.roleId, record.gameDate, record.startTime, record.endTime]);
  const seen = new Set(records.map(key));
  let nextId = records.reduce((max, record) => Math.max(max, record.id ?? 0), 0) + 1;
  let addedCount = 0;
  for (const record of incoming) {
    const id = key(record);
    if (seen.has(id)) continue;
    seen.add(id);
    const { roleId, gameDate, startTime, endTime, duration } = record;
    records.push({
      roleId,
      gameDate,
      startTime,
      endTime,
      duration,
      id: nextId++,
    });
    addedCount++;
  }
  return { records, addedCount, duplicateCount: incoming.length - addedCount };
}

export function importGameTimeRecords(incoming: readonly GameTimeRecord[]) {
  return updateGameTimeRecords((existing) => {
    const merged = mergeImportedGameTime(existing, incoming);
    return {
      records: merged.addedCount ? merged.records : existing,
      result: merged,
    };
  });
}
