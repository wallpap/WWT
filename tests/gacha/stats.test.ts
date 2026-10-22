import { describe, expect, test } from "bun:test";
import type { GachaRecord } from "../../src/gacha/model.ts";
import { summarizeGacha } from "../../src/gacha/stats.ts";

const record = (name: string, qualityLevel: number, time: string, count = 1): GachaRecord => ({
  playerId: "player-1",
  gachaName: "角色活动唤取",
  cardPoolType: "角色活动",
  resourceId: qualityLevel * 100,
  qualityLevel,
  resourceType: "角色",
  name,
  count,
  time,
});

describe("summarizeGacha", () => {
  test("calculates counts, cost, date range and most frequent five-star", () => {
    const result = summarizeGacha([record("测试五星", 5, "2026-01-02T00:00:00Z"), record("测试五星", 5, "2026-01-03T00:00:00Z"), record("四星物品", 4, "2026-01-01T00:00:00Z", 10), record("三星物品", 3, "2026-01-04T00:00:00Z")]);

    expect(result).toMatchObject({
      totalPulls: 13,
      totalStones: 2080,
      ssrCount: 2,
      upSsrCount: 2,
      nonBannerRate: 100,
      rolePulls: 13,
      roleSsr: 2,
      roleAveragePullsPerSsr: 6.5,
      weaponPulls: 0,
      weaponSsr: 0,
      weaponAveragePullsPerSsr: 0,
      topUpSsr: "测试五星",
      srCount: 1,
      rCount: 1,
      averagePullsPerSsr: 6.5,
      startTime: "2026-01-01T00:00:00Z",
      endTime: "2026-01-04T00:00:00Z",
      topSsr: "测试五星",
    });
  });

  test("calculates the 50/50 win rate and excludes guarantee pulls", () => {
    const result = summarizeGacha([
      { ...record("UP", 5, "2026-01-01T00:00:00Z"), resourceId: 1209 },
      { ...record("常驻", 5, "2026-01-02T00:00:00Z"), resourceId: 1104 },
      { ...record("保底UP", 5, "2026-01-03T00:00:00Z"), resourceId: 1305 },
    ]);
    expect(result.upSsrCount).toBe(2);
    expect(result.nonBannerRate).toBe(50);
  });

  test("counts pulls by pool type rather than the dropped resource or display name", () => {
    const result = summarizeGacha([
      {
        ...record("三星武器", 3, "2026-01-01T00:00:00Z", 2),
        resourceType: "武器",
      },
      {
        ...record("四星角色", 4, "2026-01-02T00:00:00Z", 3),
        cardPoolType: "武器活动",
      },
      {
        ...record("常驻五星", 5, "2026-01-03T00:00:00Z"),
        cardPoolType: "角色常驻",
        resourceId: 1104,
      },
      {
        ...record("未知池", 3, "2026-01-04T00:00:00Z"),
        cardPoolType: "未知角色池",
        gachaName: "自定义角色活动",
      },
    ]);
    expect(result).toMatchObject({
      rolePulls: 3,
      weaponPulls: 3,
      roleSsr: 1,
      weaponSsr: 0,
    });
  });

  test("isolates 50/50 guarantees between players and unconfirmed pool groups", () => {
    const loss = {
      ...record("常驻", 5, "2026-01-01T00:00:00Z"),
      resourceId: 1104,
    };
    const win = {
      ...record("UP", 5, "2026-01-02T00:00:00Z"),
      resourceId: 1607,
    };
    expect(summarizeGacha([loss, { ...win, playerId: "player-2" }]).nonBannerRate).toBe(50);
    expect(
      summarizeGacha([
        { ...loss, cardPoolType: "独立保底组A" },
        { ...win, cardPoolType: "独立保底组B" },
      ]).nonBannerRate,
    ).toBe(50);
  });

  test("shares guarantees within a confirmed pool group across display names", () => {
    const result = summarizeGacha([
      {
        ...record("常驻", 5, "2026-01-01T00:00:00Z"),
        resourceId: 1104,
        gachaName: "旧活动标题",
      },
      {
        ...record("保底UP", 5, "2026-01-02T00:00:00Z"),
        gachaName: "新活动标题",
        cardPoolType: "角色活动唤取",
      },
      { ...record("UP", 5, "2026-01-03T00:00:00Z"), gachaName: "新活动标题" },
    ]);
    expect(result.nonBannerRate).toBe(50);
  });

  test("orders mixed local and ISO timestamps before applying guarantees", () => {
    const local = "2026-01-01 10:00:00";
    const earlier = new Date(new Date(local).getTime() - 60_000).toISOString();
    const result = summarizeGacha([
      { ...record("保底UP", 5, local), resourceId: 1607 },
      { ...record("常驻", 5, earlier), resourceId: 1104 },
    ]);
    expect(result.nonBannerRate).toBe(0);
    expect(result.startTime).toBe(earlier);
    expect(result.endTime).toBe(local);
  });

  test("returns zero average and empty date range for no records", () => {
    expect(summarizeGacha([]).averagePullsPerSsr).toBe(0);
    expect(summarizeGacha([]).startTime).toBeNull();
  });
});
