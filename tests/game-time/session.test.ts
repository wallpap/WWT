import { describe, expect, test } from "bun:test";
import { splitGameSession } from "../../src/game-time/session.ts";

describe("splitGameSession", () => {
  test("splits an automatic session at local midnight", () => {
    const start = new Date(2026, 9, 18, 23, 50).getTime();
    const end = new Date(2026, 9, 19, 0, 20).getTime();
    expect(splitGameSession(null, start, end).map((record) => [record.gameDate, record.duration])).toEqual([
      ["2026-10-18", 10 * 60_000],
      ["2026-10-19", 20 * 60_000],
    ]);
  });
});
