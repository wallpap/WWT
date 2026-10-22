import type { GameTimeRecord } from "./model.ts";
import { summarizeGameTime } from "./stats.ts";

const daysPerWeek = 7;
const weekdayToMondayOffset = daysPerWeek - 1;

export interface GameTimeFilter {
  roleId: string;
  start: string;
  end: string;
}
export function filterGameTime(records: readonly GameTimeRecord[], filter: GameTimeFilter): GameTimeRecord[] {
  return records.filter((record) => (!filter.roleId || record.roleId === filter.roleId || (filter.roleId === "unassigned" && record.roleId === null)) && (!filter.start || record.gameDate >= filter.start) && (!filter.end || record.gameDate <= filter.end));
}
export function gameTimeOverview(records: readonly GameTimeRecord[], today: string) {
  const summary = summarizeGameTime(records, today);
  const [year, month, day] = today.split("-").map(Number);
  const reference = new Date(year!, month! - 1, day!);
  const week = new Date(reference);
  week.setDate(week.getDate() - ((week.getDay() + weekdayToMondayOffset) % daysPerWeek));
  const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const sumFrom = (start: string) => Object.entries(summary.byDate).reduce((sum, [date, duration]) => sum + (date >= start && date <= today ? duration : 0), 0);
  const days = Object.entries(summary.byDate).sort(([a], [b]) => a.localeCompare(b));
  const activeDays = days.filter(([, duration]) => duration > 0).length;
  return {
    ...summary,
    weekDuration: sumFrom(key(week)),
    monthDuration: sumFrom(`${year}-${String(month).padStart(2, "0")}-01`),
    activeDays,
    averageActiveDay: activeDays ? summary.totalDuration / activeDays : 0,
    longestDay: days.reduce((max, [, duration]) => Math.max(max, duration), 0),
    days,
  };
}
