import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { buildBrowser } from "../../scripts/browser-build.ts";
import type { RoleCultivation } from "../../src/kujiequ/cultivation.ts";
import { buildRoleAim } from "../../src/kujiequ/calculator-aim.ts";

const build = await buildBrowser({
  entrypoints: [fileURLToPath(new URL("../../src/kujiequ/calculator-controls.ts", import.meta.url))],
  format: "cjs",
});
if (!build.success) throw new Error("养成控件构建失败");
const script = await build.outputs[0]!.text();

class Control {
  value = "";
  textContent = "";
  disabled = false;
  checked = false;
  dataset: Record<string, string> = {};
  children: Control[] = [];
  listeners = new Map<string, () => unknown>();
  append(...items: Control[]): void {
    this.children.push(...items);
  }
  replaceChildren(...items: Control[]): void {
    this.children = items;
    this.value = items[0]?.value ?? "";
  }
  setAttribute(): void {}
  addEventListener(event: string, handler: () => unknown): void {
    this.listeners.set(event, handler);
  }
  async fire(event: string): Promise<void> {
    await this.listeners.get(event)?.();
  }
}

test("syncing cultivation fills current levels, excludes unlocked nodes and ignores an obsolete account response", async () => {
  const elements = new Map<string, Control>();
  const find = (id: string): Control => {
    let value = elements.get(id);
    if (!value) {
      value = new Control();
      elements.set(id, value);
    }
    return value;
  };
  const listeners = new Map<string, (event?: unknown) => void>();
  let release: ((value: RoleCultivation) => void) | undefined;
  const cultivation: RoleCultivation = {
    roleId: "101",
    roleLevel: 80,
    skillLevels: [2, 3, 7, 4, 5],
    unlockedNodes: ["2-1"],
  };
  let deferred = false;
  let submittedRole: unknown;
  let submittedWeapon: unknown;
  const module = {
    exports: {} as { initializeCalculatorControls?: () => void },
  };
  runInNewContext(script, {
    module,
    exports: module.exports,
    document: {
      querySelector: (selector: string) => find(selector.slice(1)),
      createElement: () => new Control(),
    },
    Option: class extends Control {
      constructor(text: string, value: string) {
        super();
        this.textContent = text;
        this.value = value;
      }
    },
    window: {
      addEventListener: (event: string, callback: (event?: unknown) => void) => listeners.set(event, callback),
      loadKuroCalculatorTargets: async () => ({ roles: [], weapons: [] }),
      loadKuroCalculator: async () => ({
        roleName: "测试账号",
        roles: [{ id: "101", name: "测试角色", starLevel: 5 }],
        weapons: [{ id: "201", name: "测试武器", starLevel: 5 }],
        updatedAt: 0,
      }),
      calculateKuroRole: async (aim: unknown) => {
        submittedRole = aim;
        return { roleCount: 1, weaponCount: 0, preview: { allCost: [], missingCost: [], synthetic: [] }, costList: [] };
      },
      calculateKuroWeapon: async (aim: unknown) => {
        submittedWeapon = aim;
        return { roleCount: 0, weaponCount: 1, preview: { allCost: [], missingCost: [], synthetic: [] }, costList: [] };
      },
      loadKuroCultivation: async () =>
        deferred
          ? new Promise<RoleCultivation>((resolve) => {
              release = resolve;
            })
          : cultivation,
    },
  });
  module.exports.initializeCalculatorControls!();
  listeners.get("page-changed")!({ detail: "calculator" });
  await Bun.sleep(0);
  const defaultRows = find("kuro-calculator-skills").children;
  expect(defaultRows.map((row) => row.children[2]!.children[0]!.value)).toEqual(["10", "10", "10", "10", "10"]);
  expect(defaultRows.every((row) => row.children[3]!.children.every((label) => label.children[0]!.checked))).toBe(true);
  find("kuro-calculator-weapon-start").value = "1";
  find("kuro-calculator-weapon-end").value = "90";
  expect(find("kuro-calculator-combined-submit").disabled).toBe(false);
  await find("kuro-calculator-combined-submit").fire("click");
  expect(submittedRole).toMatchObject({ roleId: "101", roleStartLevel: 1, roleEndLevel: 90 });
  expect(submittedWeapon).toEqual({ weaponId: "201", weaponStartLevel: 1, weaponEndLevel: 90 });
  expect(find("kuro-calculator-metrics").children[0]!.children[1]!.textContent).toBe("2");
  await find("kuro-calculator-sync").fire("click");
  expect(find("kuro-calculator-role-start").value).toBe("80");
  const rows = find("kuro-calculator-skills").children;
  expect(rows.map((row) => row.children[1]!.children[0]!.value)).toEqual(["2", "3", "7", "4", "5"]);
  expect(rows[0]!.children[3]!.children[0]!.children[0]).toMatchObject({
    checked: false,
    disabled: true,
  });
  expect(rows[1]!.children[3]!.children[0]!.children[0]).toMatchObject({
    checked: true,
    disabled: false,
  });
  expect(rows.map((row) => row.children[2]!.children[0]!.value)).toEqual(["10", "10", "10", "10", "10"]);
  deferred = true;
  const pending = find("kuro-calculator-sync").fire("click");
  listeners.get("kuro-account-changed")!();
  release!(cultivation);
  await pending;
  await Bun.sleep(0);
  expect(find("kuro-calculator-role-start").value).toBe("1");
  expect(rows.map((row) => row.children[1]!.children[0]!.value)).toEqual(["1", "1", "1", "1", "1"]);
});

test("saved targets can be calculated together after a catalogue failure and a stale batch result cannot cross accounts", async () => {
  const elements = new Map<string, Control>();
  const find = (id: string): Control => {
    let value = elements.get(id);
    if (!value) {
      value = new Control();
      elements.set(id, value);
    }
    return value;
  };
  const listeners = new Map<string, (event?: unknown) => void>();
  const aims = ["101", "102"].map((id) =>
    buildRoleAim(
      id,
      1,
      90,
      Array.from({ length: 5 }, () => ({ startLevel: 1, endLevel: 8 })),
    ),
  );
  let submitted: unknown;
  let release: ((value: unknown) => void) | undefined;
  const module = {
    exports: {} as { initializeCalculatorControls?: () => void },
  };
  runInNewContext(script, {
    module,
    exports: module.exports,
    document: {
      querySelector: (selector: string) => find(selector.slice(1)),
      createElement: () => new Control(),
    },
    window: {
      addEventListener: (event: string, callback: (event?: unknown) => void) => listeners.set(event, callback),
      loadKuroCalculator: async () => {
        throw new Error("catalogue offline");
      },
      loadKuroCalculatorTargets: async () => ({ roles: aims, weapons: [] }),
      calculateKuroRoleBatch: async (value: unknown) => {
        submitted = value;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    },
  });
  module.exports.initializeCalculatorControls!();
  listeners.get("page-changed")!({ detail: "calculator" });
  await Bun.sleep(0);
  expect(find("kuro-calculator-targets").children).toHaveLength(2);
  expect(find("kuro-calculator-role-batch").disabled).toBe(false);
  await find("kuro-calculator-role-batch").fire("click");
  expect(submitted).toEqual(aims);
  listeners.get("kuro-account-changed")!();
  release!({
    roleCount: 2,
    weaponCount: 0,
    preview: { allCost: [], missingCost: [], synthetic: [] },
  });
  await Bun.sleep(0);
  expect(find("kuro-calculator-metrics").children).toHaveLength(0);
});
