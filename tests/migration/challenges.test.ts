import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readMigrationSource } from "../../src/migration/read.ts";
import { MigrationService } from "../../src/migration/service.ts";
import { ChallengeHistoryStore, legacyChallengeKey } from "../../src/kujiequ/challenge-history.ts";
import { ChallengeService, parseTower, parseSlash, parseNewTower } from "../../src/kujiequ/challenge.ts";
import { AccountService } from "../../src/kujiequ/accounts.ts";
import { KuroApi } from "../../src/kujiequ/api.ts";
import { serverId, type AccountState } from "../../src/kujiequ/model.ts";

const endTime = Date.UTC(2026, 9, 19, 20);
function fixture(path: string): void {
  const db = new Database(path, { create: true });
  try {
    db.exec("CREATE TABLE game_tower(id INTEGER PRIMARY KEY, role_id TEXT, floor INTEGER, role_list TEXT, star INTEGER, area_id INTEGER, area_name TEXT, endTime INTEGER); CREATE TABLE game_slash(id INTEGER PRIMARY KEY, role_id TEXT, end_time INTEGER, data TEXT); CREATE TABLE game_new_tower(id INTEGER PRIMARY KEY, role_id TEXT, end_time INTEGER, data TEXT); CREATE TABLE user_info(token TEXT)");
    db.query("INSERT INTO user_info VALUES(?)").run("fixture-secret-ignore");
    for (const [id, player, floor, stars] of [
      [1, "1001", 1, 3],
      [2, "1001", 2, 2],
      [3, "1002", 1, 1],
    ] as const)
      db.query("INSERT INTO game_tower VALUES(?, ?, ?, '101, 102', ?, 1, '测试塔', ?)").run(id, player, floor, stars, endTime);
    db.query("INSERT INTO game_slash VALUES(1, '1001', ?, ?)").run(
      endTime,
      JSON.stringify([
        {
          difficulty: 1,
          allScore: 800,
          maxScore: 1000,
          challengeList: [{ challengeName: "第一关", score: 800, rank: "S", halfList: [] }],
        },
      ]),
    );
    db.query("INSERT INTO game_new_tower VALUES(1, '1001', ?, ?)").run(
      endTime,
      JSON.stringify([
        {
          modeId: 1,
          score: 500,
          hasRecord: true,
          teams: [{ score: 500, roleList: [{ roleId: 101 }] }],
        },
      ]),
    );
  } finally {
    db.close();
  }
}

test("legacy challenge preview and import preserve original bytes, periods and player ownership", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wwt-legacy-challenges-"));
  const path = join(directory, "sqlite.db");
  const archive = join(directory, "history.json");
  try {
    fixture(path);
    const before = await readFile(path);
    const store = new ChallengeHistoryStore(archive);
    const service = new MigrationService(readMigrationSource, undefined, undefined, (records) => store.importLegacy(records));
    const preview = await service.preview("java-sqlite", path);
    expect(preview).toMatchObject({
      challengeCount: 4,
      playerCount: 2,
      gachaCount: 0,
      gameTimeCount: 0,
    });
    expect(await Bun.file(archive).exists()).toBe(false);
    expect(await service.import(preview.id, "challenges")).toEqual({
      addedCount: 4,
      duplicateCount: 0,
    });
    expect(await service.import(preview.id, "challenges")).toEqual({
      addedCount: 0,
      duplicateCount: 4,
    });
    const saved = await new ChallengeHistoryStore(archive).list(legacyChallengeKey("1001"));
    expect(saved).toHaveLength(3);
    expect(saved.every((item) => item.endTime === endTime && item.updatedAt === 0)).toBe(true);
    expect(saved.find((item) => item.kind === "tower")).toMatchObject({
      data: {
        areas: [
          {
            stars: 5,
            maxStars: 6,
            floors: [
              { floor: "1", roleCount: 2 },
              { floor: "2", stars: 2 },
            ],
          },
        ],
      },
    });
    expect(saved.find((item) => item.kind === "slash")).toMatchObject({
      data: { difficulties: [{ score: 800 }] },
    });
    expect(saved.find((item) => item.kind === "new-tower")).toMatchObject({
      data: { modes: [{ teams: [{ roleCount: 1 }] }] },
    });
    expect(await store.list(legacyChallengeKey("1002"))).toHaveLength(1);
    expect(await readFile(path)).toEqual(before);
    expect(await readFile(archive, "utf8")).not.toContain("fixture-secret-ignore");
    const valid = await readMigrationSource("java-sqlite", path);
    const malformed = { ...valid.challenges![0]!, roleId: "invalid" };
    const untouched = await readFile(archive);
    await expect(store.importLegacy([{ ...valid.challenges![0]!, roleId: "1003" }, malformed])).rejects.toThrow("玩家 ID 无效");
    expect(await readFile(archive)).toEqual(untouched);
    const db = new Database(path);
    db.exec("UPDATE game_slash SET data = 'broken'");
    db.close();
    await expect(service.preview("java-sqlite", path)).rejects.toThrow("JSON 无效");
    await expect(service.import(preview.id, "challenges")).rejects.toThrow("重新读取");
    await writeFile(archive, "broken");
    await expect(store.importLegacy(valid.challenges!)).rejects.toThrow("读取本地挑战历史失败");
    expect(await readFile(archive, "utf8")).toBe("broken");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("challenge history includes only the selected national player's archive and prefers current snapshots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wwt-challenge-ownership-"));
  try {
    const path = join(directory, "sqlite.db");
    fixture(path);
    const store = new ChallengeHistoryStore(join(directory, "history.json"));
    await store.importLegacy((await readMigrationSource("java-sqlite", path)).challenges!);
    const role = {
      roleId: "1001",
      roleName: "测试",
      userId: "12",
      serverId,
      serverName: "国服",
    };
    const state: AccountState = {
      accounts: [
        {
          id: "fixture",
          label: "测试",
          token: "fixture-token",
          did: "fixture-did",
          source: "h5",
          roles: [role],
        },
      ],
      selectedAccountId: "fixture",
      selectedRoleId: role.roleId,
    };
    let requests = 0;
    const api = new KuroApi(async () => {
      requests++;
      throw new Error("unexpected network");
    }, 0);
    const accounts = new AccountService(api, {
      read: async () => structuredClone(state),
      write: async () => {},
    });
    const service = new ChallengeService(accounts, store);
    expect(await service.history()).toHaveLength(3);
    await store.merge(JSON.stringify(["fixture", "1001", serverId]), {
      roleId: "1001",
      roleName: "测试",
      updatedAt: 1000,
      tower: parseTower({
        isUnlock: true,
        seasonEndTime: endTime,
        difficultyList: [],
      }),
      slash: parseSlash({}),
      newTower: parseNewTower({}),
    });
    expect((await service.history()).find((item) => item.kind === "tower")?.updatedAt).toBe(1000);
    role.serverId = "other-server";
    expect(await service.history()).toEqual([]);
    role.serverId = serverId;
    role.roleId = "1002";
    state.selectedRoleId = "1002";
    expect(await service.history()).toHaveLength(1);
    expect(requests).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
