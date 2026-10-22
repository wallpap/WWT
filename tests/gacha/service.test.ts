import { expect, test } from "bun:test";
import { createGachaService } from "../../src/gacha/service.ts";
import { OnlineGachaClient } from "../../src/gacha/online.ts";
import type { GachaRecord } from "../../src/gacha/model.ts";

const card: GachaRecord = {
  playerId: "10001",
  gachaName: "角色活动唤取",
  cardPoolType: "角色活动",
  resourceId: 1,
  qualityLevel: 5,
  resourceType: "角色",
  name: "测试",
  count: 1,
  time: "2026-10-19 12:00:00",
};
const link = "https://example.invalid/aki/gacha/index.html#/record?player_id=10001&record_id=fixture&resources_id=1&gacha_type=1&svr_id=cn&lang=zh-Hans";

test("serializes imports, preserves other players and deduplicates online records", async () => {
  let records: GachaRecord[] = [];
  const service = createGachaService(
    {
      read: async () => [...records],
      write: async (next) => {
        await Bun.sleep(1);
        records = [...next];
      },
    },
    new OnlineGachaClient(
      async (_url, options) =>
        Response.json({
          code: 0,
          data: JSON.parse(String(options.body)).cardPoolType === "1" ? [card] : [],
        }),
      0,
    ),
  );
  await Promise.all([service.importRecords(JSON.stringify([card])), service.importRecords(JSON.stringify([{ ...card, playerId: "20002" }]))]);
  const result = await service.queryRecords(link);
  expect(result.addedCount).toBe(0);
  expect(result.duplicateCount).toBe(1);
  expect(records).toHaveLength(2);
});

test("failed online batch writes nothing, and a failed save does not block later imports", async () => {
  let writes = 0;
  let calls = 0;
  const service = createGachaService(
    {
      read: async () => [],
      write: async () => {
        writes++;
        if (writes === 1) throw new Error("disk full");
      },
    },
    new OnlineGachaClient(async () => Response.json(++calls === 1 ? { code: 0, data: [card] } : { code: 1 }), 0),
  );
  await expect(service.queryRecords(link)).rejects.toThrow("官方接口拒绝");
  expect(writes).toBe(0);
  await expect(service.importRecords(JSON.stringify([card]))).rejects.toThrow("disk full");
  expect((await service.importRecords(JSON.stringify([card]))).addedCount).toBe(1);
});
