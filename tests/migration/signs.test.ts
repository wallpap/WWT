import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readMigrationSource } from "../../src/migration/read.ts";
import { MigrationService } from "../../src/migration/service.ts";
import { SignHistoryStore, legacySignKey } from "../../src/kujiequ/sign-store.ts";
import { SignService } from "../../src/kujiequ/sign.ts";
import { AccountService } from "../../src/kujiequ/accounts.ts";
import { KuroApi } from "../../src/kujiequ/api.ts";
import { serverId, type AccountState } from "../../src/kujiequ/model.ts";

test("legacy sign imports preserve long order IDs, deduplicate and remain readable offline for the matching player", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wwt-legacy-signs-"));
  const path = join(directory, "sqlite.db");
  const archive = join(directory, "signs.json");
  try {
    const db = new Database(path, { create: true });
    db.exec("CREATE TABLE sign_history(id INTEGER PRIMARY KEY, role_id TEXT, goods_name TEXT, goods_num INTEGER, sign_date TEXT); INSERT INTO sign_history VALUES(9223372036854775806, '1001', '星声', 20, '2026-10-19'), (9223372036854775807, '1002', '贝币', 10000, '2026-10-18')");
    db.close();
    const before = await readFile(path);
    const store = new SignHistoryStore(archive);
    const migration = new MigrationService(readMigrationSource, undefined, undefined, undefined, (records) => store.importLegacy(records));
    const preview = await migration.preview("java-sqlite", path);
    expect(preview).toMatchObject({
      playerCount: 2,
      signCount: 2,
      challengeCount: 0,
    });
    expect(await Bun.file(archive).exists()).toBe(false);
    expect(await migration.import(preview.id, "signs")).toEqual({
      addedCount: 2,
      duplicateCount: 0,
    });
    expect(await migration.import(preview.id, "signs")).toEqual({
      addedCount: 0,
      duplicateCount: 2,
    });
    const restored = new SignHistoryStore(archive);
    expect((await restored.list(legacySignKey("1001")))[0]).toEqual({
      orderCode: "9223372036854775806",
      date: "2026-10-19",
      name: "星声",
      count: "20",
    });
    expect(await readFile(path)).toEqual(before);
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
    const accounts = new AccountService(
      new KuroApi(async () => {
        requests++;
        throw new Error("offline");
      }, 0),
      { read: async () => structuredClone(state), write: async () => {} },
    );
    const service = new SignService(accounts, store);
    expect((await service.localHistory()).history).toHaveLength(1);
    await store.merge(JSON.stringify(["fixture", "1001", serverId]), [
      {
        orderCode: "9223372036854775806",
        date: "2026-10-19",
        name: "更新后的奖励",
        count: "20",
      },
    ]);
    expect((await service.localHistory()).history).toMatchObject([{ name: "更新后的奖励" }]);
    role.roleId = "1002";
    state.selectedRoleId = "1002";
    expect((await service.localHistory()).history).toMatchObject([{ name: "贝币" }]);
    role.serverId = "other-server";
    expect((await service.localHistory()).history).toEqual([]);
    expect(requests).toBe(0);
    const incoming = (await readMigrationSource("java-sqlite", path)).signs!;
    const unchanged = await readFile(archive);
    await expect(
      store.importLegacy([
        { ...incoming[0]!, roleId: "1003" },
        { ...incoming[1]!, roleId: "bad" },
      ]),
    ).rejects.toThrow("玩家 ID 无效");
    expect(await readFile(archive)).toEqual(unchanged);
    await writeFile(archive, "broken");
    await expect(store.importLegacy(incoming)).rejects.toThrow("读取签到历史失败");
    expect(await readFile(archive, "utf8")).toBe("broken");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
