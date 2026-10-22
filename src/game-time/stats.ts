import type { GameTimeRecord, GameTimeSummary } from "./model.ts";
import { millisecondsPerMinute, minutesPerHour } from "../units.ts";

export function summarizeGameTime(records: readonly GameTimeRecord[], today: string): GameTimeSummary {
  const byDate: Record<string, number> = {};
  for (const record of records) byDate[record.gameDate] = (byDate[record.gameDate] ?? 0) + record.duration;
  return {
    todayDuration: byDate[today] ?? 0,
    totalDuration: records.reduce((total, record) => total + record.duration, 0),
    recordCount: records.length,
    byDate,
  };
}

export function formatGameTime(duration: number): string {
  const totalMinutes = Math.floor(Math.max(0, duration) / millisecondsPerMinute);
  return `${Math.floor(totalMinutes / minutesPerHour)}小时${String(totalMinutes % minutesPerHour).padStart(2, "0")}分钟`;
}
