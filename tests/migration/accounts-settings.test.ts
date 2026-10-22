import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountService } from "../../src/kujiequ/accounts.ts";
import { AccountStore } from "../../src/kujiequ/store.ts";
import { KuroApi } from "../../src/kujiequ/api.ts";
import { nationalRole, type LegacyAccount } from "../../src/kujiequ/legacy-account.ts";
import { AppSettingsStore } from "../../src/app/settings.ts";
import { GameSettingsStore } from "../../src/game/settings.ts";
import { readMigrationSource } from "../../src/migration/read.ts";
import { MigrationService } from "../../src/migration/service.ts";

const legacy = (user = "12", role = "10001"): LegacyAccount => ({
  role: nationalRole(user, role, "测试角色"),
  token: "fixture-session",
  did: "fixture-device",
  source: "android",
  preferred: false,
});

test("Java account preview is read-only, hides credentials and imports into encrypted sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-legacy-accounts-"));
  const path = join(root, "sqlite.db");
  try {
    const db = new Database(path, { create: true });
    db.exec("CREATE TABLE user_info(id INTEGER PRIMARY KEY, user_id TEXT, role_id TEXT, role_name TEXT, token TEXT, dev_code TEXT, is_web INTEGER, is_main INTEGER)");
    db.query("INSERT INTO user_info VALUES(1, '12', '10001', '测试角色', ?, ?, 0, 1)").run("fixture-session", "fixture-device");
    db.close();
    const before = await readFile(path);
    const service = new AccountService(new KuroApi(), new AccountStore(join(root, "sessions.bin")));
    const migration = new MigrationService(undefined, undefined, undefined, undefined, undefined, { accounts: (records) => service.importLegacy(records) });
    const preview = await migration.preview("java-accounts", path);
    expect(preview).toMatchObject({ accountRoleCount: 1, playerCount: 1 });
    expect(JSON.stringify(preview)).not.toContain("fixture-session");
    expect(JSON.stringify(preview)).not.toContain("fixture-device");
    expect((await service.view()).accounts).toHaveLength(0);
    expect(await migration.import(preview.id, "accounts")).toEqual({
      addedCount: 1,
      duplicateCount: 0,
    });
    expect(await migration.import(preview.id, "accounts")).toEqual({
      addedCount: 0,
      duplicateCount: 1,
    });
    expect((await service.context()).session).toMatchObject({
      token: "fixture-session",
      source: "android",
      did: "fixture-device",
    });
    expect((await readFile(join(root, "sessions.bin"))).includes(Buffer.from("fixture-session"))).toBe(false);
    expect(await readFile(path)).toEqual(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("account merges preserve sessions and selection, group roles, and roll back oversized batches", async () => {
  let state = {
    accounts: [
      {
        id: "existing",
        label: "已有账号",
        roles: [nationalRole("12", "10001", "已有角色")],
        token: "existing-session",
        did: "existing-device",
        source: "h5" as const,
      },
    ],
    selectedAccountId: "existing" as string | null,
    selectedRoleId: "10001" as string | null,
  };
  const service = new AccountService(new KuroApi(), {
    read: async () => state,
    write: async (next) => {
      state = structuredClone(next) as typeof state;
    },
  });
  expect(await service.importLegacy([legacy(), legacy("12", "10002"), { ...legacy("13", "20001"), preferred: true }])).toEqual({ addedCount: 2, duplicateCount: 1 });
  expect((await service.context()).session).toMatchObject({
    token: "existing-session",
    did: "existing-device",
    source: "h5",
  });
  expect(state.accounts).toHaveLength(2);
  expect(state.accounts[0]?.roles).toHaveLength(2);
  const before = structuredClone(state);
  await expect(service.importLegacy(Array.from({ length: 8 }, (_, i) => legacy(String(i + 20), String(i + 30000))))).rejects.toThrow("超过 9");
  expect(state).toEqual(before);
  state.selectedAccountId = null;
  state.selectedRoleId = null;
  await service.importLegacy([legacy()]);
  expect((await service.context()).role.roleId).toBe("10001");
});

test("settings migration fills missing keys, preserves explicit choices and rejects corrupt destinations", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-import-settings-"));
  try {
    const appPath = join(root, "app.json"),
      gamePath = join(root, "game.json");
    const app = new AppSettingsStore(appPath),
      game = new GameSettingsStore(gamePath);
    await writeFile(appPath, JSON.stringify({ downloadParallel: 4 }));
    expect(
      await app.importMissing({
        downloadParallel: 8,
        downloadBytesPerSecond: 1024,
      }),
    ).toEqual({ addedCount: 1, duplicateCount: 1 });
    expect(await app.read()).toMatchObject({
      downloadParallel: 4,
      downloadBytesPerSecond: 1024,
    });
    expect(await app.importMissing({ downloadBytesPerSecond: 2048 })).toEqual({
      addedCount: 0,
      duplicateCount: 1,
    });
    await writeFile(gamePath, JSON.stringify({ executablePath: "" }));
    expect(
      await game.importMissing({
        executablePath: "C:\\OldGame.exe",
        resourceTier: "hd",
      }),
    ).toEqual({ addedCount: 1, duplicateCount: 1 });
    expect(await game.read()).toEqual({
      executablePath: "",
      resourceTier: "hd",
    });
    const fresh = new GameSettingsStore(join(root, "fresh.json"));
    expect(await fresh.importMissing({ executablePath: "C:\\Game.exe" })).toEqual({ addedCount: 1, duplicateCount: 0 });
    expect((await fresh.read()).executablePath).toBe("C:\\Game.exe");
    await writeFile(appPath, "broken");
    await writeFile(gamePath, "broken");
    await expect(app.importMissing({ downloadParallel: 4 })).rejects.toThrow();
    await expect(game.importMissing({ executablePath: "C:\\Game.exe" })).rejects.toThrow();
    expect(await readFile(appPath, "utf8")).toBe("broken");
    expect(await readFile(gamePath, "utf8")).toBe("broken");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
