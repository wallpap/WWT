import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { buildBrowser } from "../../scripts/browser-build.ts";
import { battleFields, type BattleRecord } from "../../src/local-data/model.ts";

class Control {
  value = "";
  textContent = "";
  className = "";
  disabled = false;
  dataset: Record<string, string> = {};
  children: Control[] = [];
  options: { value: string }[] = [];
  listeners = new Map<string, () => unknown>();
  addEventListener(name: string, handler: () => unknown): void {
    this.listeners.set(name, handler);
  }
  append(...children: Control[]): void {
    this.children.push(...children);
  }
  replaceChildren(...children: Control[]): void {
    this.children = children;
    this.options = children;
  }
  add(option: Control): void {
    this.options.push(option);
  }
}

test("local archive filters battle totals by player and date and searches catalog without mixing players", async () => {
  const build = await buildBrowser({
    entrypoints: [fileURLToPath(new URL("../../src/local-data/controls.ts", import.meta.url))],
    format: "cjs",
  });
  if (!build.success) throw new Error("本地档案控件构建失败");
  const controls = new Map<string, Control>(),
    events = new Map<string, (event?: unknown) => void>();
  const find = (id: string): Control => {
    let control = controls.get(id);
    if (!control) {
      control = new Control();
      controls.set(id, control);
    }
    return control;
  };
  const base = {
    ...Object.fromEntries(Object.keys(battleFields).map((key) => [key, 0])),
    monthCard: false,
    monthCardRemainDays: 0,
  } as BattleRecord;
  const archive = {
    battles: [
      { ...base, roleId: "1001", date: "2026-10-19", battle: 3 },
      { ...base, roleId: "1001", date: "2026-10-18", battle: 2 },
      { ...base, roleId: "1002", date: "2026-10-19", battle: 9 },
    ],
    players: [
      {
        roleId: "1001",
        name: "玩家一",
        level: 80,
        region: "国服",
        sex: 1,
        updatedAt: 1,
      },
    ],
    roles: [
      {
        roleId: "101",
        name: "漂泊者",
        acronym: "PBZ",
        attributeName: "衍射",
        weaponTypeName: "迅刀",
        starLevel: 5,
        breach: 6,
      },
    ],
  };
  const module = { exports: {} as { initializeLocalDataControls: () => void } };
  runInNewContext(await build.outputs[0]!.text(), {
    module,
    exports: module.exports,
    Option: class extends Control {
      constructor(label: string, value: string) {
        super();
        this.textContent = label;
        this.value = value;
      }
    },
    document: {
      querySelector: (selector: string) => find(selector.slice(1)),
      createElement: () => new Control(),
    },
    window: {
      loadLocalArchive: async () => archive,
      addEventListener: (name: string, callback: (event?: unknown) => void) => events.set(name, callback),
    },
  });
  module.exports.initializeLocalDataControls();
  events.get("page-changed")!({ detail: "local-data" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(find("local-data-battles").children).toHaveLength(3);
  find("local-data-player").value = "1001";
  find("local-data-start").value = "2026-10-19";
  find("local-data-start").listeners.get("change")!();
  expect(find("local-data-battles").children).toHaveLength(1);
  expect(find("local-data-metrics").children.find((item) => item.children[0]?.textContent === "战斗")?.children[1]?.textContent).toBe("3");
  find("local-data-search").value = "pbz";
  find("local-data-search").listeners.get("input")!();
  expect(find("local-data-roles").children).toHaveLength(1);
  find("local-data-search").value = "未匹配";
  find("local-data-search").listeners.get("input")!();
  expect(find("local-data-roles").children).toHaveLength(0);
  events.get("local-archive-changed")!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(find("local-data-player").value).toBe("1001");
});
