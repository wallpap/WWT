import { describe, expect, test } from "bun:test";
import { parseGameLogLines } from "../../src/game-time/log-parser.ts";

const line = (timestamp: string, content: string): string => `[${timestamp}][GameThread] ${content}`;

describe("parseGameLogLines", () => {
  test("tracks an account session and splits it at local midnight", () => {
    const records = parseGameLogLines([line("2026.10.18-23.50.00:000", "SetUserId [playerId: 1001]"), line("2026.10.19-00.20.00:000", "heartbeat")]);

    expect(records).toHaveLength(2);
    expect(
      records.map((record) => ({
        date: record.gameDate,
        duration: record.duration,
      })),
    ).toEqual([
      { date: "2026-10-18", duration: 10 * 60_000 },
      { date: "2026-10-19", duration: 20 * 60_000 },
    ]);
  });

  test("closes the previous account when the log reports an account switch", () => {
    const records = parseGameLogLines([line("2026.10.19-10.00.00:000", "SetUserId [playerId: 1001]"), line("2026.10.19-10.15.00:000", "SetUserId [playerId: 1002]"), line("2026.10.19-10.30.00:000", "heartbeat")]);

    expect(records.map((record) => [record.roleId, record.duration])).toEqual([
      ["1001", 15 * 60_000],
      ["1002", 15 * 60_000],
    ]);
  });

  test("can filter out short sessions", () => {
    const records = parseGameLogLines([line("2026.10.19-10.00.00:000", "SetUserId [playerId: 1001]"), line("2026.10.19-10.00.30:000", "heartbeat")], { minimumDuration: 60_000 });

    expect(records).toEqual([]);
  });

  test("ignores malformed calendar timestamps", () => {
    const records = parseGameLogLines([line("2026.02.31-10.00.00:000", "SetUserId [playerId: 1001]"), line("2026.03.01-10.00.00:000", "heartbeat")]);
    expect(records).toEqual([]);
  });
});
