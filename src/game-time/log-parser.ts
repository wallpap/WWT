import type { GameTimeRecord } from "./model.ts";

const timestampPattern = /\[(?<timestamp>\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}:\d{3})\]/;
const accountPattern = /SetUserId\s+\[playerId:\s*(\d+)/;
const timestampFormat = /^(?<year>\d{4})\.(?<month>\d{2})\.(?<day>\d{2})-(?<hour>\d{2})\.(?<minute>\d{2})\.(?<second>\d{2}):(?<millisecond>\d{3})$/;

interface ActiveSession {
  roleId: string;
  startTime: number;
}

export interface GameLogParseOptions {
  minimumDuration?: number;
}

function parseTimestamp(value: string): number | null {
  const match = timestampFormat.exec(value);
  if (!match?.groups) return null;
  const { year, month, day, hour, minute, second, millisecond } = match.groups;
  const parsed = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
    millisecond: Number(millisecond),
  };
  const zeroBasedMonth = parsed.month - 1;
  const timestamp = new Date(parsed.year, zeroBasedMonth, parsed.day, parsed.hour, parsed.minute, parsed.second, parsed.millisecond);
  if (Number.isNaN(timestamp.getTime())) return null;
  return timestamp.getFullYear() === parsed.year && timestamp.getMonth() === zeroBasedMonth && timestamp.getDate() === parsed.day && timestamp.getHours() === parsed.hour && timestamp.getMinutes() === parsed.minute && timestamp.getSeconds() === parsed.second && timestamp.getMilliseconds() === parsed.millisecond ? timestamp.getTime() : null;
}

export function timestampFromLine(line: string): number | null {
  const match = timestampPattern.exec(line);
  const timestamp = match?.groups?.["timestamp"];
  return timestamp === undefined ? null : parseTimestamp(timestamp);
}

function dateKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function splitSession(roleId: string, startTime: number, endTime: number): GameTimeRecord[] {
  if (endTime <= startTime) return [];
  const records: GameTimeRecord[] = [];
  let segmentStart = startTime;
  while (segmentStart < endTime) {
    const segmentDate = new Date(segmentStart);
    const nextDay = new Date(segmentDate.getFullYear(), segmentDate.getMonth(), segmentDate.getDate() + 1).getTime();
    const segmentEnd = Math.min(endTime, nextDay);
    records.push({
      roleId,
      gameDate: dateKey(segmentStart),
      startTime: segmentStart,
      endTime: segmentEnd,
      duration: segmentEnd - segmentStart,
    });
    segmentStart = segmentEnd;
  }
  return records;
}

export function parseGameLogLines(lines: Iterable<string>, options: GameLogParseOptions = {}): GameTimeRecord[] {
  const minimumDuration = options.minimumDuration ?? 0;
  let active: ActiveSession | null = null;
  let lastTimestamp: number | null = null;
  const records: GameTimeRecord[] = [];

  for (const line of lines) {
    const timestamp = timestampFromLine(line);
    if (timestamp !== null) lastTimestamp = timestamp;
    const account = accountPattern.exec(line)?.[1];
    if (account === undefined || timestamp === null) continue;

    if (active !== null && active.roleId !== account) {
      records.push(...splitSession(active.roleId, active.startTime, timestamp));
      active = null;
    }
    if (active === null) active = { roleId: account, startTime: timestamp };
  }

  if (active !== null && lastTimestamp !== null) records.push(...splitSession(active.roleId, active.startTime, lastTimestamp));
  return records.filter((record) => record.duration >= minimumDuration);
}
