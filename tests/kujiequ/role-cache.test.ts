import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RoleCacheStore } from "../../src/kujiequ/role-cache.ts";
import { RoleService, parseOwnedRoles, parseRoleDetail } from "../../src/kujiequ/role.ts";
import { AccountService } from "../../src/kujiequ/accounts.ts";
import { KuroApi } from "../../src/kujiequ/api.ts";
import type { AccountState } from "../../src/kujiequ/model.ts";

const roles = parseOwnedRoles({
  roleList: [
    { roleId: "101", roleName: "漂泊者", level: 80 },
    { roleId: "102", roleName: "秧秧", level: 70 },
  ],
});
const detail = parseRoleDetail({ role: { roleId: "101" } }, roles[0]!);

test("role cache preserves concurrent details, rejects older writes and prunes removed characters across restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wwt-role-cache-"));
  const path = join(directory, "cache.json");
  try {
    const store = new RoleCacheStore(path);
    await store.saveList("account-A", { roles, updatedAt: 100 });
    await Promise.all([
      store.saveDetail("account-A", { detail, updatedAt: 101 }),
      store.saveDetail("account-A", {
        detail: { ...detail, roleId: "102" },
        updatedAt: 102,
      }),
      store.saveList("account-B", { roles: [], updatedAt: 100 }),
    ]);
    await store.saveDetail("account-A", {
      detail: { ...detail, level: 1 },
      updatedAt: 99,
    });
    await store.saveList("account-A", { roles: [], updatedAt: 99 });
    const restored = await new RoleCacheStore(path).read("account-A");
    expect(restored?.details["101"]?.detail.level).toBe(80);
    expect(Object.keys(restored!.details)).toHaveLength(2);
    expect((await store.read("account-B"))?.roles).toEqual([]);
    expect(await store.read("unknown")).toBeNull();
    await store.saveList("account-A", { roles: [roles[0]!], updatedAt: 103 });
    expect(Object.keys((await store.read("account-A"))!.details)).toEqual(["101"]);
    await writeFile(path, "broken json");
    await expect(store.saveList("account-A", { roles, updatedAt: 200 })).rejects.toThrow("读取本地角色缓存失败");
    expect(await readFile(path, "utf8")).toBe("broken json");
    await writeFile(
      path,
      JSON.stringify({
        "account-A": {
          ...restored,
          details: { "102": { detail, updatedAt: 102 } },
        },
      }),
    );
    await expect(store.read("account-A")).rejects.toThrow("归属无效");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("role service saves normalized business data and restores it offline without crossing account or server scopes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wwt-role-offline-"));
  const path = join(directory, "cache.json");
  try {
    let queries = 0;
    let offline = false;
    const api = new KuroApi(async (url) => {
      queries++;
      if (offline) throw new Error("offline");
      const endpoint = new URL(url).pathname;
      return Response.json({
        code: 200,
        data: endpoint.endsWith("requestToken")
          ? { accessToken: "fixture-access-secret" }
          : endpoint.endsWith("roleData")
            ? {
                roleList: [{ roleId: "101", roleName: "漂泊者", level: 80 }],
                token: "discard-me",
              }
            : { role: { roleId: "101" }, level: 80 },
      });
    }, 0);
    const role = {
      roleId: "10001",
      roleName: "测试",
      userId: "12",
      serverId: "cn",
      serverName: "国服",
    };
    let state: AccountState = {
      accounts: [
        {
          id: "fixture",
          label: "测试",
          token: "fixture-session-secret",
          did: "fixture-device-secret",
          source: "h5",
          roles: [role],
        },
      ],
      selectedAccountId: "fixture",
      selectedRoleId: role.roleId,
    };
    const accounts = new AccountService(api, {
      read: async () => structuredClone(state),
      write: async (next) => {
        state = structuredClone(next);
      },
    });
    await new RoleService(accounts, new RoleCacheStore(path)).load();
    const contents = await readFile(path, "utf8");
    for (const secret of ["fixture-access-secret", "fixture-session-secret", "fixture-device-secret", "discard-me"]) expect(contents).not.toContain(secret);
    offline = true;
    const service = new RoleService(accounts, new RoleCacheStore(path));
    const before = queries;
    expect((await service.local()).detail?.level).toBe(80);
    expect((await service.detail("101", true)).roleId).toBe("101");
    await expect(service.detail("102", true)).rejects.toThrow("尚无本地详情");
    expect(queries).toBe(before);
    state.accounts[0]!.roles[0]!.serverId = "other-server";
    await expect(service.local()).rejects.toThrow("暂无本地缓存");
    state.accounts[0]!.roles[0]!.serverId = "cn";
    state.accounts[0]!.id = "another-account";
    state.selectedAccountId = "another-account";
    await expect(service.local()).rejects.toThrow("暂无本地缓存");
    expect(queries).toBe(before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
