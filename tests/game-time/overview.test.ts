import { expect, test } from "bun:test";
import { filterGameTime, gameTimeOverview } from "../../src/game-time/overview.ts";
import type { GameTimeRecord } from "../../src/game-time/model.ts";
const record = (roleId: string | null, gameDate: string, hours: number): GameTimeRecord => ({
  roleId,
  gameDate,
  startTime: 0,
  endTime: hours * 3_600_000,
  duration: hours * 3_600_000,
});

test("time overview applies player and date filters before computing Monday-based weeks and calendar months", () => {
  const records = [record("123", "2026-09-30", 1), record("123", "2026-10-18", 2), record("123", "2026-10-19", 3), record("123", "2026-10-20", 4), record("456", "2026-10-20", 10), record(null, "2026-10-20", 20)];
  const filtered = filterGameTime(records, {
    roleId: "123",
    start: "",
    end: "",
  });
  const overview = gameTimeOverview(filtered, "2026-10-20");
  expect(overview.weekDuration).toBe(7 * 3_600_000);
  expect(overview.monthDuration).toBe(9 * 3_600_000);
  expect(overview.totalDuration).toBe(10 * 3_600_000);
  expect(overview.activeDays).toBe(4);
  expect(overview.averageActiveDay).toBe(2.5 * 3_600_000);
  expect(overview.longestDay).toBe(4 * 3_600_000);
  expect(
    filterGameTime(records, {
      roleId: "unassigned",
      start: "2026-10-20",
      end: "2026-10-20",
    }),
  ).toHaveLength(1);
  expect(
    filterGameTime(records, {
      roleId: "123",
      start: "2026-10-19",
      end: "2026-10-20",
    }),
  ).toHaveLength(2);
  expect(gameTimeOverview([], "2026-10-20").averageActiveDay).toBe(0);
});
