import { expect, test } from "bun:test";
import { MigrationService } from "../../src/migration/service.ts";
import { createGachaService } from "../../src/gacha/service.ts";
import { mergeImportedGameTime } from "../../src/game-time/import.ts";
import type { GachaRecord } from "../../src/gacha/model.ts";
import type { GameTimeRecord } from "../../src/game-time/model.ts";
import type { MigrationRecords } from "../../src/migration/read.ts";

const card: GachaRecord = {
  playerId: "1001",
  gachaName: "角色活动唤取",
  cardPoolType: "1",
  resourceId: 1607,
  qualityLevel: 5,
  resourceType: "角色",
  name: "测试角色",
  count: 1,
  time: "2026-10-19 12:00:00",
};
const time: GameTimeRecord = {
  roleId: "1001",
  gameDate: "2026-10-19",
  startTime: 1000,
  endTime: 61000,
  duration: 60000,
};

test("preview writes nothing and imports each kind through the existing deduplication paths", async () => {
  let gacha: GachaRecord[] = [{ ...card, playerId: "other" }];
  let times: GameTimeRecord[] = [{ ...time, id: 10, roleId: "other" }];
  const gachaService = createGachaService({
    read: async () => gacha,
    write: async (next) => {
      gacha = [...next];
    },
  });
  const service = new MigrationService(
    async () => ({ gacha: [card, card], gameTime: [time] }),
    gachaService.importRecords,
    async (incoming) => {
      const result = mergeImportedGameTime(times, incoming);
      times = result.records;
      return result;
    },
  );
  const preview = await service.preview("java-sqlite", "fixture.db");
  expect(preview).toMatchObject({
    gachaCount: 2,
    gachaPulls: 2,
    gameTimeCount: 1,
    gameTimeDuration: 60000,
    playerCount: 1,
  });
  expect(gacha).toHaveLength(1);
  expect(times).toHaveLength(1);
  expect(await service.import(preview.id, "gacha")).toEqual({
    addedCount: 2,
    duplicateCount: 0,
  });
  expect(await service.import(preview.id, "gacha")).toEqual({
    addedCount: 0,
    duplicateCount: 2,
  });
  expect(await service.import(preview.id, "game-time")).toEqual({
    addedCount: 1,
    duplicateCount: 0,
  });
  expect(await service.import(preview.id, "game-time")).toEqual({
    addedCount: 0,
    duplicateCount: 1,
  });
  expect(gacha.map((row) => row.playerId)).toContain("other");
  expect(times[1]).toMatchObject({ ...time, id: 11 });
});

test("failed and superseded previews revoke previous imports without replacing the latest snapshot", async () => {
  let release!: (records: MigrationRecords) => void;
  const service = new MigrationService(async (_source, path) => {
    if (path === "bad") throw new Error("数据格式无效");
    if (path === "slow")
      return new Promise<MigrationRecords>((resolve) => {
        release = resolve;
      });
    return { gacha: [], gameTime: [] };
  });
  const first = await service.preview("xlsx", "first");
  await expect(service.preview("xlsx", "bad")).rejects.toThrow("数据格式无效");
  await expect(service.import(first.id, "gacha")).rejects.toThrow("重新读取");
  const slow = service.preview("xlsx", "slow");
  const latest = await service.preview("xlsx", "latest");
  release({ gacha: [], gameTime: [] });
  await expect(slow).rejects.toThrow("来源已变化");
  expect(await service.import(latest.id, "gacha")).toEqual({
    addedCount: 0,
    duplicateCount: 0,
  });
});
