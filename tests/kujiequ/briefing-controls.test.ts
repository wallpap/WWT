import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { buildBrowser } from "../../scripts/browser-build.ts";

const build = await buildBrowser({
  entrypoints: [fileURLToPath(new URL("../../src/kujiequ/briefing-controls.ts", import.meta.url))],
  format: "cjs",
});
const script = await build.outputs[0]!.text();
class Control {
  value = "";
  textContent = "";
  disabled = false;
  dataset: Record<string, string> = {};
  children: Control[] = [];
  listeners = new Map<string, () => void>();
  append(...items: Control[]): void {
    this.children.push(...items);
  }
  replaceChildren(...items: Control[]): void {
    this.children = items;
    this.value = items[0]?.value ?? "";
  }
  setAttribute(): void {}
  removeAttribute(): void {}
  addEventListener(name: string, handler: () => void): void {
    this.listeners.set(name, handler);
  }
  fire(name: string): void {
    this.listeners.get(name)?.();
  }
}

test("briefing starts at the newest cycle and preserves an explicitly selected history cycle on refresh", async () => {
  const controls = new Map<string, Control>();
  const find = (id: string): Control => {
    let item = controls.get(id);
    if (!item) {
      item = new Control();
      controls.set(id, item);
    }
    return item;
  };
  find("kuro-briefing-kind").value = "week";
  const module = { exports: {} as { initializeBriefingControls: () => void } };
  const queries: string[] = [];
  runInNewContext(script, {
    module,
    exports: module.exports,
    document: {
      querySelector: (selector: string) => find(selector.slice(1)),
      createElement: () => new Control(),
    },
    Option: class extends Control {
      constructor(label: string, value: string) {
        super();
        this.textContent = label;
        this.value = value;
      }
    },
    window: {
      addEventListener: () => {},
      loadKuroBriefingPeriods: async () => ({
        weeks: [
          { title: "旧周期", index: "202640" },
          { title: "最新周期", index: "202643" },
        ],
        months: [
          { title: "九月", index: "9" },
          { title: "十月", index: "10" },
        ],
        versions: [],
      }),
      loadKuroBriefingDetail: async (kind: string, index: string) => {
        queries.push(index);
        return {
          kind,
          period: { title: index, index },
          updatedAt: 1000,
          record: {
            totalCoin: 0,
            totalStar: 0,
            coinItems: [],
            starItems: [],
            description: "",
          },
        };
      },
    },
  });
  module.exports.initializeBriefingControls();
  find("kuro-briefing-refresh").fire("click");
  await Bun.sleep(0);
  expect(queries.at(-1)).toBe("202643");
  find("kuro-briefing-period").value = "202640";
  find("kuro-briefing-refresh").fire("click");
  await Bun.sleep(0);
  expect(queries.at(-1)).toBe("202640");
  find("kuro-briefing-kind").value = "month";
  find("kuro-briefing-kind").fire("change");
  await Bun.sleep(0);
  expect(queries.at(-1)).toBe("10");
});
