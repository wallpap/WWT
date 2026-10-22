import { describe, expect, test } from "bun:test";
import type { GachaRecord } from "../../src/gacha/model.ts";
import { mergeGachaRecords } from "../../src/gacha/store.ts";
import { parseGachaImport } from "../../src/gacha/import.ts";

const record = (time: string, name = "测试角色"): GachaRecord => ({
  playerId: "player-1",
  gachaName: "角色活动唤取",
  cardPoolType: "角色活动",
  resourceId: 1607,
  qualityLevel: 5,
  resourceType: "角色",
  name,
  count: 1,
  time,
});

describe("mergeGachaRecords", () => {
  test("keeps existing copies, skips repeated imports and sorts by time", () => {
    const result = mergeGachaRecords([record("2026-02-02T00:00:00Z")], [record("2026-02-02T00:00:00Z"), record("2026-02-01T00:00:00Z")]);

    expect(result.addedCount).toBe(1);
    expect(result.records.map((item) => item.time)).toEqual(["2026-02-01T00:00:00Z", "2026-02-02T00:00:00Z"]);
  });

  test("deduplicates equivalent Java, exported JSON and pool.json times against stored records", () => {
    const local = "2026-06-21 12:00:00";
    const existing = record(local);
    const java = parseGachaImport(JSON.stringify([{ ...existing, time: new Date(local).getTime() }]));
    const exported = parseGachaImport(JSON.stringify([{ ...existing, time: new Date(local).toISOString() }]));
    const legacy = parseGachaImport(JSON.stringify({ [existing.gachaName]: [existing] }), existing.playerId);
    for (const incoming of [java, exported, legacy]) {
      const result = mergeGachaRecords([existing], incoming);
      expect(result.addedCount).toBe(0);
      expect(result.records).toEqual([existing]);
    }
    expect(mergeGachaRecords(java, legacy).records).toHaveLength(1);
  });

  test("preserves identical pulls in one batch and merges overlapping batches by occurrence count", () => {
    const pull = record("2026-06-21 12:00:00", "测试武器");
    const first = mergeGachaRecords([], [pull, pull, pull]);
    expect(first.addedCount).toBe(3);
    expect(first.records).toHaveLength(3);
    expect(mergeGachaRecords(first.records, [pull, pull, pull]).addedCount).toBe(0);
    const more = mergeGachaRecords(first.records, [pull, pull, pull, pull]);
    expect(more.addedCount).toBe(1);
    expect(more.records).toHaveLength(4);
    expect(mergeGachaRecords(more.records, [pull]).records).toHaveLength(4);
  });

  test("sorts mixed time formats by instant and keeps different players and pools", () => {
    const local = "2026-06-21 12:00:00";
    const earlier = record(new Date(new Date(local).getTime() - 60_000).toISOString());
    const later = record(local);
    const otherPlayer = { ...later, playerId: "player-2" };
    const otherPool = {
      ...later,
      gachaName: "角色常驻唤取",
      cardPoolType: "角色常驻",
    };
    const result = mergeGachaRecords([later], [earlier, otherPlayer, otherPool]);
    expect(result.records[0]).toEqual(earlier);
    expect(result.addedCount).toBe(3);
  });
});
