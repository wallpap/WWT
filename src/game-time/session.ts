import type { GameTimeRecord } from "./model.ts";

export function splitGameSession(roleId: string | null, startTime: number, endTime: number): Omit<GameTimeRecord, "id">[] {
  if (!Number.isSafeInteger(startTime) || !Number.isSafeInteger(endTime) || endTime <= startTime) return [];
  const records: Omit<GameTimeRecord, "id">[] = [];
  let segmentStart = startTime;
  while (segmentStart < endTime) {
    const start = new Date(segmentStart);
    const nextDay = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1).getTime();
    const segmentEnd = Math.min(endTime, nextDay);
    records.push({
      roleId,
      gameDate: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`,
      startTime: segmentStart,
      endTime: segmentEnd,
      duration: segmentEnd - segmentStart,
    });
    segmentStart = segmentEnd;
  }
  return records;
}
