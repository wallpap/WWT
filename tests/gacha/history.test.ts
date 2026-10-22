import { expect, test } from "bun:test";
import { buildGachaHistory } from "../../src/gacha/history.ts";
import { summarizeGacha } from "../../src/gacha/stats.ts";
import type { GachaRecord } from "../../src/gacha/model.ts";

const row = (index: number, qualityLevel = 3, overrides: Partial<GachaRecord> = {}): GachaRecord => ({
  playerId: "1001",
  gachaName: "活动标题",
  cardPoolType: "1",
  resourceId: 1607,
  qualityLevel,
  resourceType: "角色",
  name: "测试",
  count: 1,
  time: new Date(1_790_000_000_000 + index * 1000).toISOString(),
  ...overrides,
});

test("pity spans confirmed aliases and event names, and averages only completed five-star intervals", () => {
  const records = [row(4, 3, { count: 3 }), row(2, 4), row(3, 5, { cardPoolType: "角色活动", gachaName: "第二期" }), row(0), row(1, 5)];
  const history = buildGachaHistory(records);
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({
    playerId: "1001",
    totalPulls: 7,
    currentFiveStarPity: 3,
    currentFourStarPity: 3,
    hasFiveStar: true,
    completedAverage: 2,
  });
  expect(
    history[0]?.fiveStars.map((item) => ({
      pulls: item.pulls,
      complete: item.complete,
    })),
  ).toEqual([
    { pulls: 2, complete: true },
    { pulls: 2, complete: false },
  ]);
  expect(records[0]?.time).toBe(row(4).time);
});

test("players, weapon pools and unknown pool groups retain independent histories", () => {
  const history = buildGachaHistory([row(0), row(1, 5, { playerId: "2002" }), row(2, 4, { cardPoolType: "2" }), row(3, 3, { cardPoolType: "unknown-a" }), row(4, 3, { cardPoolType: "unknown-b" })]);
  expect(history).toHaveLength(5);
  expect(history[0]).toMatchObject({
    hasFiveStar: false,
    completedAverage: null,
    currentFiveStarPity: 1,
  });
  expect(history.find((item) => item.poolName === "武器活动唤取")).toMatchObject({ currentFiveStarPity: 1, currentFourStarPity: 0 });
  expect(buildGachaHistory([])).toEqual([]);
});

test("numeric pool IDs classify all thirteen pools and share banner guarantees with localized types", () => {
  const all = Array.from({ length: 13 }, (_, index) => row(index, 3, { cardPoolType: String(index + 1) }));
  expect(summarizeGacha(all)).toMatchObject({
    totalPulls: 13,
    rolePulls: 8,
    weaponPulls: 5,
  });
  expect(summarizeGacha([row(0, 5, { resourceId: 1104 }), row(1, 5, { cardPoolType: "角色活动", resourceId: 1607 })]).nonBannerRate).toBe(0);
});
