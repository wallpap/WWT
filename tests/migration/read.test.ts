import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMigrationSource } from "../../src/migration/read.ts";
import { mergeImportedGameTime } from "../../src/game-time/import.ts";
import { fileURLToPath } from "node:url";

const card = {
  player_id: "100000001",
  gacha_name: "角色活动唤取",
  card_pool_type: "1",
  resource_id: 1607,
  quality_level: 5,
  resource_type: "角色",
  name: "测试角色",
  count: 1,
  time: "2026-10-19 12:00:00",
};

test("migration preview accepts original XLSX and an explicitly identified older workbook", async () => {
  const records = await readMigrationSource("xlsx", fileURLToPath(new URL("../gacha/fixtures/java-gacha.xlsx", import.meta.url)));
  expect(records.gacha).toHaveLength(2);
  expect(records.gameTime).toEqual([]);
  const old = await readMigrationSource("xlsx", fileURLToPath(new URL("../gacha/fixtures/java-gacha-no-uid.xlsx", import.meta.url)), "100000001");
  expect(old).toEqual(records);
});

test("reads only Java business records without modifying the original SQLite file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wwt-migration-"));
  const path = join(directory, "sqlite.db");
  const db = new Database(path, { create: true });
  try {
    db.exec("CREATE TABLE game_gacha(id INTEGER PRIMARY KEY, player_id TEXT, gacha_name TEXT, card_pool_type TEXT, resource_id INTEGER, quality_level INTEGER, resource_type TEXT, name TEXT, count INTEGER, time INTEGER); CREATE TABLE game_time(id INTEGER PRIMARY KEY, role_id TEXT, game_date TEXT, start_time INTEGER, end_time INTEGER, duration INTEGER); CREATE TABLE user_info(token TEXT)");
    db.query("INSERT INTO game_gacha VALUES(1, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(card.player_id, card.gacha_name, card.card_pool_type, card.resource_id, card.quality_level, card.resource_type, card.name, card.count, Date.parse(card.time));
    db.query("INSERT INTO game_time VALUES(1, NULL, '2026-10-19', 1000, 61000, 60000)").run();
    db.query("INSERT INTO user_info VALUES(?)").run("fixture-private");
    db.close();
    const before = await readFile(path);
    const records = await readMigrationSource("java-sqlite", path);
    expect(records.gacha).toHaveLength(1);
    expect(records.gacha[0]).toMatchObject({
      playerId: card.player_id,
      resourceId: 1607,
      time: new Date(card.time).toISOString(),
    });
    expect(records.gameTime).toEqual([
      {
        roleId: null,
        gameDate: "2026-10-19",
        startTime: 1000,
        endTime: 61000,
        duration: 60000,
      },
    ]);
    expect(JSON.stringify(records)).not.toContain("fixture-private");
    expect(await readFile(path)).toEqual(before);
    await expect(readMigrationSource("java-sqlite", join(directory, "missing.db"))).rejects.toThrow();
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects invalid original game time records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wwt-invalid-time-"));
  try {
    const db = new Database(join(directory, "bad.db"), { create: true });
    db.exec("CREATE TABLE game_time(id INTEGER PRIMARY KEY, role_id TEXT, game_date TEXT, start_time INTEGER, end_time INTEGER, duration INTEGER); INSERT INTO game_time VALUES(1, '1001', '2026-02-30', 1000, 61000, 60000)");
    db.close();
    await expect(readMigrationSource("java-sqlite", join(directory, "bad.db"))).rejects.toThrow("时长记录无效");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("historical time imports preserve existing records, allocate IDs and deduplicate retries", () => {
  const old = {
    id: 8,
    source: "log" as const,
    roleId: "1001",
    gameDate: "2026-10-19",
    startTime: 0,
    endTime: 60000,
    duration: 60000,
  };
  const added = {
    ...old,
    id: 1,
    source: undefined,
    startTime: 120000,
    endTime: 180000,
  };
  const { source: _source, ...incoming } = added;
  const result = mergeImportedGameTime([old], [old, incoming, incoming]);
  expect(result.records).toEqual([
    old,
    {
      roleId: "1001",
      gameDate: "2026-10-19",
      startTime: 120000,
      endTime: 180000,
      duration: 60000,
      id: 9,
    },
  ]);
  expect(result).toMatchObject({ addedCount: 1, duplicateCount: 2 });
  expect(mergeImportedGameTime(result.records, [incoming]).addedCount).toBe(0);
});
