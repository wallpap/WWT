import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { buildBrowser } from "../../scripts/browser-build.ts";

class Control {
  value = "";
  textContent = "";
  disabled = false;
  hidden = false;
  dataset: Record<string, string> = {};
  listeners = new Map<string, () => unknown>();
  addEventListener(name: string, handler: () => unknown): void {
    this.listeners.set(name, handler);
  }
  async fire(name: string): Promise<void> {
    await this.listeners.get(name)?.();
  }
}

test("migration controls preview history counts, import each kind and invalidate stale selections", async () => {
  const build = await buildBrowser({
    entrypoints: [fileURLToPath(new URL("../../src/migration/controls.ts", import.meta.url))],
    format: "cjs",
  });
  if (!build.success) throw new Error("迁移控件构建失败");
  const controls = new Map<string, Control>();
  const find = (id: string): Control => {
    let item = controls.get(id);
    if (!item) {
      item = new Control();
      controls.set(id, item);
    }
    return item;
  };
  const calls: string[] = [];
  const events: string[] = [];
  const module = {
    exports: {} as { initializeMigrationControls?: () => void },
  };
  runInNewContext(await build.outputs[0]!.text(), {
    module,
    exports: module.exports,
    Event,
    document: { querySelector: (selector: string) => find(selector.slice(1)) },
    window: {
      previewMigration: async () => ({
        id: "snapshot",
        playerCount: 2,
        gachaCount: 0,
        gachaPulls: 0,
        gameTimeCount: 0,
        gameTimeDuration: 0,
        challengeCount: 4,
        signCount: 2,
        accountRoleCount: 2,
        settingCount: 3,
        battleCount: 2,
        localPlayerCount: 1,
        catalogRoleCount: 1,
      }),
      importMigration: async (id: string, kind: string) => {
        calls.push(`${id}:${kind}`);
        return { addedCount: 2, duplicateCount: 0 };
      },
      dispatchEvent: (event: Event) => {
        events.push(event.type);
      },
    },
  });
  find("migration-source").value = "java-sqlite";
  module.exports.initializeMigrationControls!();
  expect(find("migration-signs").disabled).toBe(true);
  find("migration-path").value = "sqlite.db";
  await find("migration-path").fire("input");
  await find("migration-preview").fire("click");
  expect(find("migration-summary").textContent).toContain("挑战历史 4 个周期 · 签到历史 2 条");
  expect(find("migration-gacha").disabled).toBe(true);
  await find("migration-challenges").fire("click");
  await find("migration-signs").fire("click");
  await find("migration-accounts").fire("click");
  await find("migration-settings").fire("click");
  await find("migration-archive").fire("click");
  expect(calls).toEqual(["snapshot:challenges", "snapshot:signs", "snapshot:accounts", "snapshot:settings", "snapshot:archive"]);
  expect(events).toEqual(["challenge-history-changed", "sign-history-changed", "kuro-accounts-imported", "app-settings-changed", "local-archive-changed"]);
  await find("migration-source").fire("change");
  expect(find("migration-signs").disabled).toBe(true);
  expect(find("migration-challenges").disabled).toBe(true);
  await find("migration-signs").fire("click");
  expect(calls).toHaveLength(5);
});
