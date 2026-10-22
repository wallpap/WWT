import { describe, expect, test } from "bun:test";
import { formatGameTime, summarizeGameTime } from "../../src/game-time/stats.ts";
import type { GameTimeRecord } from "../../src/game-time/model.ts";

const record = (gameDate: string, duration: number): GameTimeRecord => ({
  roleId: "player-1",
  gameDate,
  startTime: 0,
  endTime: duration,
  duration,
});

describe("game-time stats", () => {
  test("summarizes today's and total duration by date", () => {
    const result = summarizeGameTime([record("2026-10-19", 90 * 60_000), record("2026-10-19", 30 * 60_000), record("2026-10-18", 2 * 60 * 60_000)], "2026-10-19");

    expect(result).toEqual({
      todayDuration: 2 * 60 * 60_000,
      totalDuration: 4 * 60 * 60_000,
      recordCount: 3,
      byDate: { "2026-10-19": 2 * 60 * 60_000, "2026-10-18": 2 * 60 * 60_000 },
    });
  });

  test("formats duration in the same hour-minute form as the original client", () => {
    expect(formatGameTime(2 * 60 * 60_000 + 5 * 60_000)).toBe("2小时05分钟");
  });
});
