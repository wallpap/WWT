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
  options: { value: string }[] = [];
  listeners = new Map<string, () => unknown>();
  addEventListener(name: string, handler: () => unknown): void {
    this.listeners.set(name, handler);
  }
  replaceChildren(...options: { value: string }[]): void {
    this.options = options;
  }
  add(option: { value: string }): void {
    this.options.push(option);
  }
}

test("imported settings refresh controls and late reads preserve edits made while loading", async () => {
  const build = await buildBrowser({
    entrypoints: [fileURLToPath(new URL("../../src/game/controls.ts", import.meta.url))],
    format: "cjs",
  });
  if (!build.success) throw new Error("游戏控件构建失败");
  const controls = new Map<string, Control>();
  const find = (id: string): Control => {
    let value = controls.get(id);
    if (!value) {
      value = new Control();
      controls.set(id, value);
    }
    return value;
  };
  const events = new Map<string, () => void>();
  let settings = { executablePath: "C:\\Old.exe", resourceTier: "hd" };
  let app = {
    downloadSource: "mainland",
    downloadParallel: 4,
    downloadBytesPerSecond: 0,
  };
  let release: ((value: typeof settings) => void) | undefined;
  let delayed = false;
  const module = { exports: {} as { initializeGameControls: () => void } };
  runInNewContext(await build.outputs[0]!.text(), {
    module,
    exports: module.exports,
    document: { querySelector: (selector: string) => find(selector.slice(1)) },
    Option: class {
      constructor(
        public label: string,
        public value: string,
      ) {}
    },
    window: {
      addEventListener: (name: string, handler: () => void) => events.set(name, handler),
      loadAppSettings: async () => app,
      loadGameSettings: async () =>
        delayed
          ? new Promise<typeof settings>((resolve) => {
              release = resolve;
            })
          : settings,
      inspectResources: async () => ({ availableTiers: ["hd", "sd"] }),
    },
  });
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  module.exports.initializeGameControls();
  await settle();
  expect(find("game-path").value).toBe("C:\\Old.exe");
  settings = { executablePath: "D:\\Imported.exe", resourceTier: "sd" };
  app = {
    downloadSource: "bilibili",
    downloadParallel: 8,
    downloadBytesPerSecond: 1048576,
  };
  events.get("app-settings-changed")!();
  await settle();
  expect(find("game-path").value).toBe("D:\\Imported.exe");
  expect(find("game-tier").value).toBe("sd");
  expect(find("resource-source").value).toBe("bilibili");
  expect(find("download-parallel").value).toBe("8");
  expect(find("download-limit").value).toBe("1");
  delayed = true;
  events.get("app-settings-changed")!();
  await settle();
  find("game-path").value = "E:\\UserEdit.exe";
  find("game-path").listeners.get("input")!();
  release!(settings);
  await settle();
  expect(find("game-path").value).toBe("E:\\UserEdit.exe");
});
