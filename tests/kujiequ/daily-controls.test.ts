import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { buildBrowser } from "../../scripts/browser-build.ts";

const build = await buildBrowser({
  entrypoints: [fileURLToPath(new URL("../../src/kujiequ/daily-controls.ts", import.meta.url))],
  format: "cjs",
});
const script = await build.outputs[0]!.text();

class MetricNode {
  className = "";
  textContent = "";
  ariaLabel = "";
  max = 0;
  value = 0;
  src = "";
  hidden = false;
  listeners = new Map<string, () => void>();
  dataset: Record<string, string> = {};
  children: MetricNode[] = [];
  append(...children: MetricNode[]): void {
    this.children.push(...children);
  }
  replaceChildren(...children: MetricNode[]): void {
    this.children = children;
  }
  addEventListener(name: string, handler: () => void): void {
    this.listeners.set(name, handler);
  }
}

test("daily metrics retain source values and draw progress only with a valid upper limit", () => {
  const module = {
    exports: {} as {
      renderKuroMetrics: (container: MetricNode, metrics: { name: string; value: string; icon?: string; iconUrl?: string }[]) => void;
    },
  };
  runInNewContext(script, {
    module,
    exports: module.exports,
    document: { createElement: () => new MetricNode() },
  });
  const container = new MetricNode();
  module.exports.renderKuroMetrics(container, [
    { name: "本周经验", value: "1000 / 12000", icon: "battlePassData" },
    { name: "终焉矩阵", value: "0 / 0" },
    { name: "奖励", value: "奖励进度：暂无数据", iconUrl: "https://example.com/challenge.png" },
  ]);
  expect(container.children[0]!.children[1]!.textContent).toBe("1000 / 12000");
  const image = container.children[0]!.children[0]!.children[0]!;
  expect(image.src).toStartWith("data:image/png;base64,");
  image.listeners.get("error")!();
  expect(image.hidden).toBe(true);
  expect(container.children[0]!.children[2]).toMatchObject({
    max: 12000,
    value: 1000,
    ariaLabel: "本周经验进度",
  });
  expect(container.children[1]!.children).toHaveLength(2);
  expect(container.children[1]!.children[1]!.textContent).toBe("0 / 0");
  expect(container.children[2]!.dataset["format"]).toBe("text");
  expect(container.children[2]!.children[1]!.textContent).toBe("奖励进度：暂无数据");
  expect(container.children[2]!.children[0]!.children[0]!.src).toBe("https://example.com/challenge.png");
});

test("remote game icons use the local cache bridge when it is available", async () => {
  const module = {
    exports: {} as {
      renderKuroMetrics: (container: MetricNode, metrics: { name: string; value: string; iconUrl?: string }[]) => void;
    },
  };
  const requests: string[] = [];
  runInNewContext(script, {
    module,
    exports: module.exports,
    document: { createElement: () => new MetricNode() },
    window: {
      loadGameImage: async (url: string) => {
        requests.push(url);
        return "data:image/png;base64,Y2FjaGVk";
      },
    },
  });
  const container = new MetricNode();
  module.exports.renderKuroMetrics(container, [
    { name: "逆境深塔", value: "12 / 36", iconUrl: "https://example.com/tower.png" },
    { name: "深塔历史", value: "24 / 36", iconUrl: "https://example.com/tower.png" },
  ]);
  await Bun.sleep(0);
  expect(requests).toEqual(["https://example.com/tower.png"]);
  expect(container.children[0]!.children[0]!.children[0]!.src).toBe("data:image/png;base64,Y2FjaGVk");
  expect(container.children[1]!.children[0]!.children[0]!.src).toBe("data:image/png;base64,Y2FjaGVk");
});
