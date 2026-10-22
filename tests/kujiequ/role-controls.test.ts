import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { buildBrowser } from "../../scripts/browser-build.ts";
import { parseOwnedRoles, parseRoleDetail } from "../../src/kujiequ/role.ts";

const build = await buildBrowser({
  entrypoints: [fileURLToPath(new URL("../../src/kujiequ/role-controls.ts", import.meta.url))],
  format: "cjs",
});
if (!build.success) throw new Error("角色控件构建失败");
const script = await build.outputs[0]!.text();
class Control {
  className = "";
  value = "";
  textContent = "";
  disabled = false;
  hidden = false;
  src = "";
  alt = "";
  parent: Control | undefined;
  children: Control[] = [];
  dataset: Record<string, string> = {};
  listeners = new Map<string, () => unknown>();
  append(...children: Control[]): void {
    for (const child of children) child.parent = this;
    this.children.push(...children);
  }
  replaceChildren(...children: Control[]): void {
    for (const child of this.children) child.parent = undefined;
    for (const child of children) child.parent = this;
    this.children = children;
    this.value = children[0]?.value ?? "";
  }
  replaceWith(child: Control): void {
    const parent = this.parent;
    if (!parent) return;
    const index = parent.children.indexOf(this);
    if (index >= 0) parent.children[index] = child;
    child.parent = parent;
    this.parent = undefined;
  }
  addEventListener(name: string, handler: () => unknown): void {
    this.listeners.set(name, handler);
  }
  async fire(name: string): Promise<void> {
    await this.listeners.get(name)?.();
  }
}

test("role controls fall back offline, switch cached characters and discard responses from a previous account", async () => {
  const roles = parseOwnedRoles({
    roleList: [
      {
        roleId: "101",
        roleName: "漂泊者",
        level: 80,
        roleIconUrl: "https://example.com/role-icon.png",
        rolePicUrl: "https://example.com/role-portrait.png",
      },
      { roleId: "102", roleName: "秧秧", level: 70 },
    ],
  });
  const detail = parseRoleDetail(
    {
      role: { roleId: "101", roleIconUrl: "https://example.com/role-icon.png", rolePicUrl: "https://example.com/role-portrait.png" },
    },
    roles[0]!,
  );
  const saved = {
    roleId: "10001",
    roleName: "测试",
    updatedAt: 1000,
    roles,
    detail,
  };
  let queries = 0;
  let resolveLocal: ((value: typeof saved) => void) | undefined;
  let delay = false;
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
  const module = { exports: {} as { initializeRoleControls?: () => void } };
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
      loadKuroRoleData: async () => {
        queries++;
        throw new Error("网络不可用");
      },
      loadLocalKuroRoleData: async () =>
        delay
          ? new Promise<typeof saved>((resolve) => {
              resolveLocal = resolve;
            })
          : saved,
      loadKuroRoleDetail: async (id: string, localOnly: boolean) => {
        expect(localOnly).toBe(true);
        if (id === "102") throw new Error("尚无本地详情");
        return detail;
      },
    },
  });
  module.exports.initializeRoleControls!();
  listeners.get("page-changed")!({ detail: "role" });
  await Bun.sleep(0);
  expect(find("kuro-role-notice").textContent).toContain("网络不可用。本地缓存");
  expect(find("kuro-role-select").children).toHaveLength(2);
  const portrait = find("kuro-role-profile").children[0]!.children[0]!;
  expect(portrait.src).toBe("https://example.com/role-icon.png");
  portrait.listeners.get("error")!();
  expect(portrait.src).toBe("https://example.com/role-portrait.png");
  portrait.listeners.get("error")!();
  expect(find("kuro-role-profile").children[0]!.children[0]!.className).toBe("role-icon-fallback");
  await find("kuro-role-local").fire("click");
  expect(queries).toBe(1);
  find("kuro-role-select").value = "102";
  await find("kuro-role-select").fire("change");
  expect(find("kuro-role-metrics").children).toEqual([]);
  expect(find("kuro-role-notice").textContent).toBe("尚无本地详情");
  delay = true;
  const pending = find("kuro-role-local").fire("click");
  listeners.get("page-changed")!({ detail: "account" });
  listeners.get("kuro-account-changed")!();
  resolveLocal!(saved);
  await pending;
  expect(find("kuro-role-select").children).toEqual([]);
  expect(find("kuro-role-metrics").children).toEqual([]);
});
