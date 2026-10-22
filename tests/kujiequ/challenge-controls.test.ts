import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { buildBrowser } from "../../scripts/browser-build.ts";
import { challengeSnapshots } from "../../src/kujiequ/challenge-history.ts";
import { parseTower, parseSlash, parseNewTower, type ChallengeView } from "../../src/kujiequ/challenge.ts";

const build = await buildBrowser({
  entrypoints: [fileURLToPath(new URL("../../src/kujiequ/challenge-controls.ts", import.meta.url))],
  format: "cjs",
});
if (!build.success) throw new Error("挑战控件构建失败");
const script = await build.outputs[0]!.text();
class Control {
  value = "";
  textContent = "";
  disabled = false;
  hidden = false;
  src = "";
  alt = "";
  width = 0;
  height = 0;
  children: Control[] = [];
  options: Control[] = [];
  dataset: Record<string, string> = {};
  listeners = new Map<string, () => unknown>();
  append(...children: Control[]): void {
    this.children.push(...children);
  }
  replaceChildren(...children: Control[]): void {
    this.children = children;
    this.options = children;
    this.value = children[0]?.value ?? "";
  }
  addEventListener(name: string, handler: () => unknown): void {
    this.listeners.set(name, handler);
  }
  async fire(name: string): Promise<void> {
    await this.listeners.get(name)?.();
  }
}

test("challenge history remains readable offline and clears when the account changes", async () => {
  const endTime = Date.UTC(2026, 10, 1);
  const view: ChallengeView = {
    roleId: "1001",
    roleName: "测试",
    updatedAt: 1000,
    tower: parseTower({
      isUnlock: true,
      seasonEndTime: endTime,
      difficultyList: [
        {
          towerAreaList: [
            {
              areaName: "历史塔",
              star: 3,
              maxStar: 12,
              floorList: [{ floor: 1, star: 3 }],
            },
            ...["回音之塔", "残响之塔", "深境之塔"].map((areaName) => ({ areaName, star: 0, maxStar: 12, floorList: [] })),
          ],
        },
      ],
    }),
    slash: parseSlash({
      isUnlock: true,
      seasonEndTime: endTime,
      difficultyList: [
        {
          difficultyName: "禁忌海域",
          allScore: 100,
          maxScore: 120,
          challengeList: [
            {
              challengeName: "第一层",
              score: 100,
              rank: "S",
              halfList: [
                {
                  score: 100,
                  roleList: [{ roleId: "101", roleName: "测试角色", iconUrl: "https://example.com/role.png" }],
                  buffName: "测试增益",
                  buffIcon: "https://example.com/buff.png",
                  buffQuality: 5,
                },
              ],
            },
          ],
        },
      ],
    }),
    newTower: parseNewTower({
      isUnlock: true, endTime,
      modeDetails: [
        { modeId: 1, score: 200, rank: 8, teams: [{ score: 200, round: 2, passBoss: 3, bossCount: 4 }] },
        { modeId: 2, score: 0, hasRecord: false, teams: [] },
      ],
    }),
  };
  let history = challengeSnapshots(view);
  let queries = 0;
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
  const module = {
    exports: {} as { initializeChallengeControls?: () => void },
  };
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
      addEventListener: (name: string, handler: (event?: unknown) => void) => listeners.set(name, handler),
      loadKuroChallenges: async () => {
        queries++;
        throw new Error("网络不可用");
      },
      loadKuroChallengeHistory: async () => history,
    },
  });
  module.exports.initializeChallengeControls!();
  listeners.get("page-changed")!({ detail: "challenge" });
  await Bun.sleep(0);
  expect(find("kuro-tower-body").children.map((column) => column.children[0]?.children[0]?.textContent)).toEqual(["残响之塔", "深境之塔", "回音之塔", "历史塔"]);
  expect(find("kuro-tower-body").children[0]?.children[2]?.textContent).toBe("暂无楼层记录");
  expect(find("kuro-challenge-notice").textContent).toContain("已载入本地历史");
  expect(find("kuro-tower-period").value).toBe(`tower:${endTime}`);
  const slashHalf = find("kuro-slash-body").children[0]!.children[2]!.children[1]!;
  const roleIcon = slashHalf.children[1]!.children[0]!.children[0]!;
  const buffIcon = slashHalf.children[2]!.children[0]!.children[0]!;
  expect(roleIcon.src).toBe("https://example.com/role.png");
  expect(buffIcon.src).toBe("https://example.com/buff.png");
  roleIcon.listeners.get("error")!();
  buffIcon.listeners.get("error")!();
  expect(roleIcon.hidden).toBe(true);
  expect(buffIcon.hidden).toBe(true);
  const modes = find("kuro-new-tower-body").children;
  expect(modes.map((mode) => mode.children[0]?.children[0]?.textContent)).toEqual(["模式 1", "模式 2"]);
  expect(modes[0]?.children[2]?.children[1]?.textContent).toBe("首领 3 / 4 · 2 轮");
  expect(modes[1]?.children[2]?.textContent).toContain("暂无挑战记录");
  await find("kuro-challenge-local").fire("click");
  expect(queries).toBe(1);
  history = [];
  listeners.get("page-changed")!({ detail: "account" });
  listeners.get("kuro-account-changed")!();
  expect(find("kuro-tower-body").children).toEqual([]);
  expect(find("kuro-tower-period").options).toEqual([]);
});
