import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MigrationService } from "../../src/migration/service.ts";
import { readMigrationSource } from "../../src/migration/read.ts";
import { LocalArchiveStore } from "../../src/local-data/store.ts";
import { emptyArchive, summarizeBattles } from "../../src/local-data/model.ts";

test("Java local archive migration preserves battle counters and projects player and catalog fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-local-data-")),
    path = join(root, "sqlite.db"),
    archivePath = join(root, "archive.json");
  try {
    const db = new Database(path, { create: true });
    db.exec(`CREATE TABLE game_record(id INTEGER PRIMARY KEY, role_id TEXT, create_date TEXT, role_change INTEGER, role_death INTEGER, battle INTEGER, phantom_get INTEGER, phantom_call_skill INTEGER, phantom_transform_skill INTEGER, paralysis INTEGER, transfer INTEGER, parry_front INTEGER, parry_back INTEGER, parry_attack INTEGER, used_strength INTEGER, month_card INTEGER, month_card_remain_days INTEGER);
      INSERT INTO game_record VALUES(1, '10001', '2026-10-19', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 120, 1, 20);
      INSERT INTO game_record VALUES(2, NULL, '2026-10-18', 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
      CREATE TABLE local_cache_player_data(id INTEGER PRIMARY KEY, role_id TEXT, role_name TEXT, level INTEGER, sex INTEGER, head_photo TEXT, region TEXT, update_time INTEGER, oauth_code TEXT, cuid TEXT);
      INSERT INTO local_cache_player_data VALUES(1, '10001', '测试玩家', 80, 1, 'icon', '国服', 1792404000000, 'fixture-oauth-secret', 'fixture-cuid-secret');
      CREATE TABLE game_role(role_id INTEGER PRIMARY KEY, role_name TEXT, role_icon_url TEXT, role_pic_url TEXT, star_level INTEGER, attribute_id INTEGER, attribute_name TEXT, weapon_type_id INTEGER, weapon_type_name TEXT, acronym TEXT, breach INTEGER);
      INSERT INTO game_role VALUES(101, '漂泊者', 'icon', 'pic', 5, 1, '衍射', 1, '迅刀', 'PBZ', 6);`);
    db.close();
    const before = await readFile(path);
    const store = new LocalArchiveStore(archivePath);
    const migration = new MigrationService(readMigrationSource, undefined, undefined, undefined, undefined, { archive: (incoming) => store.importLegacy(incoming) });
    const preview = await migration.preview("java-sqlite", path);
    expect(preview).toMatchObject({
      battleCount: 2,
      localPlayerCount: 1,
      catalogRoleCount: 1,
      playerCount: 1,
    });
    expect(await Bun.file(archivePath).exists()).toBe(false);
    expect(await migration.import(preview.id, "archive")).toEqual({
      addedCount: 4,
      duplicateCount: 0,
    });
    expect(await migration.import(preview.id, "archive")).toEqual({
      addedCount: 0,
      duplicateCount: 4,
    });
    const archive = await new LocalArchiveStore(archivePath).read();
    expect(archive.battles[0]).toMatchObject({
      roleId: "10001",
      date: "2026-10-19",
      phantomCallSkill: 5,
      phantomTransformSkill: 6,
      usedStrength: 120,
      monthCard: true,
      monthCardRemainDays: 20,
    });
    expect(summarizeBattles(archive.battles)).toMatchObject({
      roleChange: 3,
      parryFront: 9,
      parryBack: 10,
    });
    expect(archive.players[0]).toMatchObject({
      roleId: "10001",
      name: "测试玩家",
      level: 80,
    });
    expect(archive.roles[0]).toMatchObject({
      roleId: "101",
      name: "漂泊者",
      acronym: "PBZ",
      weaponTypeName: "迅刀",
    });
    for (const secret of ["fixture-oauth-secret", "fixture-cuid-secret"]) expect(JSON.stringify(archive)).not.toContain(secret);
    expect(await readFile(path)).toEqual(before);
    const player = archive.players[0]!;
    await store.importLegacy({
      ...emptyArchive(),
      players: [{ ...player, name: "新版玩家", updatedAt: player.updatedAt + 1000 }],
    });
    await store.importLegacy({ ...emptyArchive(), players: [player] });
    expect((await store.read()).players[0]?.name).toBe("新版玩家");
    await writeFile(archivePath, "broken");
    await expect(store.importLegacy(archive)).rejects.toThrow("读取本地档案失败");
    expect(await readFile(archivePath, "utf8")).toBe("broken");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
