import { millisecondsPerHour } from "../units.ts";
import { chinaUtcOffsetHours } from "./constants.ts";

export function chinaDate(timestamp: number): string {
  return new Date(timestamp + chinaUtcOffsetHours * millisecondsPerHour).toISOString().slice(0, 10);
}

export function cachedToday(savedAt: number, now = Date.now()): boolean {
  return savedAt <= now && chinaDate(savedAt) === chinaDate(now);
}
