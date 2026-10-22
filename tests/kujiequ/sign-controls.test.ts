import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { buildBrowser } from "../../scripts/browser-build.ts";

class Control {
  className = "";
  textContent = "";
  disabled = false;
  hidden = false;
  dataset: Record<string, string> = {};
  children: Control[] = [];
  listeners = new Map<string, () => unknown>();
  append(...children: Control[]): void {
    this.children.push(...children);
  }
  replaceChildren(...children: Control[]): void {
    this.children = children;
  }
  addEventListener(name: string, handler: () => unknown): void {
    this.listeners.set(name, handler);
  }
  async fire(name: string): Promise<void> {
    await this.listeners.get(name)?.();
  }
}

test("local sign history does not query or submit and discards data after account switching", async () => {
  const build = await buildBrowser({
    entrypoints: [fileURLToPath(new URL("../../src/kujiequ/sign-controls.ts", import.meta.url))],
    format: "cjs",
  });
  if (!build.success) throw new Error("签到控件构建失败");
  const controls = new Map<string, Control>();
  const find = (id: string): Control => {
    let item = controls.get(id);
    if (!item) {
      item = new Control();
      controls.set(id, item);
    }
    return item;
  };
  const listeners = new Map<string, (event?: unknown) => void>();
  const saved = {
    roleName: "测试",
    history: [{ orderCode: "1", date: "2026-10-19", name: "星声", count: "20" }],
  };
  let network = 0;
  let delay = false;
  let resolve!: (value: typeof saved) => void;
  const module = { exports: {} as { initializeSignControls?: () => void } };
  runInNewContext(await build.outputs[0]!.text(), {
    module,
    exports: module.exports,
    document: {
      querySelector: (selector: string) => find(selector.slice(1)),
      createElement: () => new Control(),
    },
    window: {
      addEventListener: (name: string, handler: (event?: unknown) => void) => listeners.set(name, handler),
      loadLocalKuroSignHistory: async () =>
        delay
          ? new Promise<typeof saved>((release) => {
              resolve = release;
            })
          : saved,
      loadKuroSign: async () => {
        network++;
        throw new Error("unexpected query");
      },
      submitKuroSign: async () => {
        network++;
        throw new Error("unexpected sign");
      },
    },
  });
  module.exports.initializeSignControls!();
  await find("kuro-sign-local").fire("click");
  const reward = find("kuro-sign-history").children[0]?.children[1]?.children[0];
  expect(reward?.children.at(-1)?.textContent).toBe("星声");
  expect(reward?.children[0]?.className).toBe("game-item-icon");
  expect(find("kuro-sign-notice").textContent).toContain("本地签到历史 1 条");
  expect(find("kuro-sign-submit").disabled).toBe(true);
  await find("kuro-sign-submit").fire("click");
  expect(network).toBe(0);
  delay = true;
  const pending = find("kuro-sign-local").fire("click");
  listeners.get("kuro-account-changed")!();
  resolve(saved);
  await pending;
  expect(find("kuro-sign-history").children).toEqual([]);
  expect(find("kuro-sign-submit").disabled).toBe(true);
});
