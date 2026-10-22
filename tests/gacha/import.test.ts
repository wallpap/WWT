import { describe, expect, test } from "bun:test";
import { parseGachaImport } from "../../src/gacha/import.ts";

describe("parseGachaImport", () => {
  test("reads Java camelCase records and epoch milliseconds", () => {
    const records = parseGachaImport(
      JSON.stringify([
        {
          playerId: "player-1",
          gachaName: "角色活动唤取",
          cardPoolType: "角色活动",
          resourceId: 1607,
          qualityLevel: 5,
          resourceType: "角色",
          name: "测试角色",
          count: 1,
          time: 1782000000000,
        },
      ]),
    );

    expect(records[0]?.playerId).toBe("player-1");
    expect(records[0]?.time).toBe(new Date(1782000000000).toISOString());
  });

  test("imports old pool.json with a supplied player id", () => {
    const records = parseGachaImport(
      JSON.stringify({
        角色活动唤取: [
          {
            cardPoolType: "角色活动",
            resourceId: 1607,
            qualityLevel: 5,
            resourceType: "角色",
            name: "测试角色",
            count: 1,
            time: "2026-06-21 12:00:00",
          },
        ],
      }),
      "player-2",
    );

    expect(records[0]).toMatchObject({
      playerId: "player-2",
      gachaName: "角色活动唤取",
    });
  });

  test("rejects legacy data without a player id and invalid timestamps", () => {
    expect(() => parseGachaImport("{}")).toThrow("旧版 pool.json 需要同时填写玩家 ID");
    expect(() =>
      parseGachaImport(
        JSON.stringify([
          {
            playerId: "player-1",
            gachaName: "角色活动唤取",
            cardPoolType: "角色活动",
            resourceId: 1607,
            qualityLevel: 5,
            resourceType: "角色",
            name: "测试角色",
            count: 1,
            time: "not-a-date",
          },
        ]),
      ),
    ).toThrow("时间无法识别");
  });
});
