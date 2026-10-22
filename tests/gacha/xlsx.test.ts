import { expect, test } from "bun:test";
import type { GachaRecord } from "../../src/gacha/model.ts";
import { encodeGachaXlsx, parseGachaXlsx } from "../../src/gacha/xlsx.ts";

test("imports an original-format seven-column XLSX with multiple sheets and shared strings", async () => {
  const path = new URL("./fixtures/java-gacha.xlsx", import.meta.url);
  const bytes = await Bun.file(path).bytes();
  const records = parseGachaXlsx(bytes);
  expect(records).toHaveLength(2);
  expect(records.every((row) => row.playerId === "100000001")).toBe(true);
  expect(records.reduce((sum, row) => sum + row.count, 0)).toBe(3);
  expect(records.map((row) => row.gachaName)).toEqual(["角色活动唤取", "武器常驻唤取"]);
});

test("imports scientific-notation numeric IDs, quality and counts from Java XLSX", async () => {
  const original = parseGachaXlsx(await Bun.file(new URL("./fixtures/java-gacha.xlsx", import.meta.url)).bytes());
  const scientific = parseGachaXlsx(await Bun.file(new URL("./fixtures/java-gacha-scientific.xlsx", import.meta.url)).bytes());
  expect(scientific).toEqual(original);
});

test("accepts an explicit player ID for older XLSX exports without a UID sheet", async () => {
  const bytes = await Bun.file(new URL("./fixtures/java-gacha-no-uid.xlsx", import.meta.url)).bytes();
  expect(() => parseGachaXlsx(bytes)).toThrow("填写玩家 ID");
  const records = parseGachaXlsx(bytes, "200000002");
  expect(records).toHaveLength(2);
  expect(records.every((row) => row.playerId === "200000002")).toBe(true);
  expect(records.reduce((sum, row) => sum + row.count, 0)).toBe(3);
});

function record(overrides: Partial<GachaRecord> = {}): GachaRecord {
  return {
    playerId: "100000001",
    gachaName: "角色/活动:唤取*测试",
    cardPoolType: "1",
    resourceId: 1607,
    qualityLevel: 5,
    resourceType: "角色",
    name: "测试角色",
    count: 1,
    time: "2026-10-19 12:00:00",
    ...overrides,
  };
}

test("XLSX export round-trips records and preserves the UID marker contract", () => {
  const records = [
    record(),
    record({
      gachaName: "武器常驻唤取",
      cardPoolType: "4",
      resourceId: 2001,
      qualityLevel: 4,
      resourceType: "武器",
      name: "测试武器",
      count: 2,
      time: "2026-10-18 09:30:00",
    }),
  ];

  expect(parseGachaXlsx(encodeGachaXlsx(records))).toEqual(records);
});

test("XLSX export keeps player IDs in the rows when multiple players are present", () => {
  const records = [record(), record({ playerId: "200000002", gachaName: "第二玩家卡池" })];
  expect(parseGachaXlsx(encodeGachaXlsx(records)).sort((left, right) => left.playerId.localeCompare(right.playerId))).toEqual(records.sort((left, right) => left.playerId.localeCompare(right.playerId)));
});

test("XLSX import rejects invalid quality and preserves nonnumeric player IDs", () => {
  const invalid = record({ qualityLevel: 2 });
  expect(() => parseGachaXlsx(encodeGachaXlsx([invalid]))).toThrow("星级必须为 3、4 或 5");

  const records = parseGachaXlsx(encodeGachaXlsx([record({ playerId: "player-1" })]));
  expect(records[0]?.playerId).toBe("player-1");
  expect(() => parseGachaXlsx(encodeGachaXlsx([record({ resourceId: 1.2e-7 })]))).toThrow("非负整数");
  expect(() => parseGachaXlsx(encodeGachaXlsx([record({ resourceId: 1e100 })]))).toThrow("超出范围");
});

test("empty XLSX exports remain readable", () => {
  expect(parseGachaXlsx(encodeGachaXlsx([]))).toEqual([]);
});
