import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountService } from "../../src/kujiequ/accounts.ts";
import { KuroApi } from "../../src/kujiequ/api.ts";
import { AccountStore } from "../../src/kujiequ/store.ts";
import type { AccountState } from "../../src/kujiequ/model.ts";

const roles = [
  { roleId: "10001", roleName: "测试角色", userId: 12 },
  { roleId: "10002", roleName: "角色二", userId: 12 },
];
function api() {
  return new KuroApi(
    async (url) =>
      Response.json({
        code: 200,
        data: url.includes("sdkLogin") ? { token: "fixture-only-session" } : roles,
      }),
    0,
  );
}
function memoryStore() {
  let state: AccountState = {
    accounts: [],
    selectedAccountId: null,
    selectedRoleId: null,
  };
  return {
    read: async () => structuredClone(state),
    write: async (next: AccountState) => {
      state = structuredClone(next);
    },
  };
}

test("SMS login establishes an Android session compatible with role authorization", async () => {
  const store = memoryStore();
  const request = new KuroApi(async (url, options) => {
    const source = (options.headers as Record<string, string>)["source"];
    if (url.includes("sdkLogin")) {
      expect(source).toBe("android");
      return Response.json({
        code: 200,
        data: { token: "fixture-android-session" },
      });
    }
    if (url.includes("requestToken")) {
      expect(source).toBe("android");
      return Response.json({
        code: 200,
        data: { accessToken: "fixture-access" },
      });
    }
    if (url.includes("/gamer/role/list")) {
      expect(source).toBe("android");
      return Response.json({ code: 200, data: roles });
    }
    return Response.json({ code: 200, data: {} });
  }, 0);
  const service = new AccountService(request, store);
  await service.login("13800000000", "123456");
  const { session, role } = await service.context();
  expect(session.source).toBe("android");
  expect(await request.roleRequest("/fixture", session, role)).toEqual({});
});

test("login persists encrypted sessions, restores role selection and never returns credentials to UI", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-account-"));
  const path = join(root, "sessions.bin");
  try {
    const service = new AccountService(api(), new AccountStore(path));
    const view = await service.login("13800000000", "123456");
    expect(view.accounts[0]?.label).toBe("138****0000");
    expect(JSON.stringify(view)).not.toContain("fixture-only-session");
    expect((await readFile(path)).includes(Buffer.from("fixture-only-session"))).toBe(false);
    const id = view.selectedAccountId!;
    await service.select(id, "10002");
    const restored = new AccountService(api(), new AccountStore(path));
    expect((await restored.context()).role.roleId).toBe("10002");
    expect((await restored.login("13800000000", "123456")).accounts).toHaveLength(1);
    await restored.remove(id);
    expect((await restored.view()).accounts).toHaveLength(0);
    await expect(restored.context()).rejects.toThrow("请先登录");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid selection and failed login preserve accounts; failed operations release the queue", async () => {
  const store = memoryStore();
  const service = new AccountService(api(), store);
  const view = await service.login("13800000000", "123456");
  await expect(service.select(view.selectedAccountId!, "other")).rejects.toThrow("不存在");
  const rejected = new AccountService(new KuroApi(async () => Response.json({ code: 220, msg: "fixture-only-session" }), 0), store);
  await expect(rejected.login("13800000000", "123456")).rejects.toThrow("登录已失效");
  expect(await rejected.view()).toEqual(view);
});

test("SMS validates phone, forwards captcha fields and enforces cooldown", async () => {
  let calls = 0;
  const service = new AccountService(
    new KuroApi(async (_url, options) => {
      calls++;
      expect((options.headers as Record<string, string>)["version"]).toBe("3.1.3");
      const fields = new URLSearchParams(String(options.body));
      expect(fields.get("mobile")).toBe("13800000000");
      expect(JSON.parse(fields.get("geeTestData")!).captcha_id).toBe("fixture");
      return Response.json({ code: 200 });
    }, 0),
    memoryStore(),
  );
  const verify = async () => Object.fromEntries(["captcha_id", "lot_number", "pass_token", "gen_time", "captcha_output"].map((key) => [key, "fixture"]));
  await expect(service.sendSms("invalid", verify)).rejects.toThrow("手机号");
  await service.sendSms("13800000000", verify);
  await expect(service.sendSms("13800000000", verify)).rejects.toThrow("稍后");
  expect(calls).toBe(1);
});

test("Token and Did login encrypts credentials and updates the existing account", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-token-account-"));
  const path = join(root, "sessions.bin");
  try {
    const store = new AccountStore(path);
    const request = new KuroApi(async (_url, options) => {
      const headers = options.headers as Record<string, string>;
      expect(headers["token"]).toBe("fixture-token-login");
      expect(headers["did"]).toBe("fixture-did-login");
      return Response.json({ code: 200, data: roles });
    }, 0);
    const service = new AccountService(request, store);
    const view = await service.loginWithToken(" fixture-token-login ", " fixture-did-login ");
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("fixture-token-login");
    expect(serialized).not.toContain("fixture-did-login");
    const bytes = await readFile(path);
    expect(bytes.includes(Buffer.from("fixture-token-login"))).toBe(false);
    expect(bytes.includes(Buffer.from("fixture-did-login"))).toBe(false);
    const restored = new AccountService(request, new AccountStore(path));
    expect((await restored.context()).session.source).toBe("android");
    const updated = await restored.loginWithToken("fixture-token-login", "fixture-did-login", "h5");
    expect(updated.accounts).toHaveLength(1);
    expect(updated.selectedAccountId).toBe(view.selectedAccountId);
    expect((await restored.context()).session.source).toBe("h5");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid or rejected Token login preserves saved accounts", async () => {
  const store = memoryStore();
  const view = await new AccountService(api(), store).login("13800000000", "123456");
  let requests = 0;
  const service = new AccountService(
    new KuroApi(async () => {
      requests++;
      return Response.json({ code: 220 });
    }, 0),
    store,
  );
  await expect(service.loginWithToken("", "fixture")).rejects.toThrow("Token 和 Did");
  await expect(service.loginWithToken("fixture\r\nvalue", "fixture")).rejects.toThrow("无效字符");
  expect(requests).toBe(0);
  await expect(service.loginWithToken("fixture-invalid", "fixture-did")).rejects.toThrow("登录已失效");
  expect(await service.view()).toEqual(view);
});
