import { expect, test } from "bun:test";
import { KuroApi } from "../../src/kujiequ/api.ts";
import type { KuroSession } from "../../src/kujiequ/model.ts";

const session: KuroSession = {
  id: "fixture",
  label: "测试",
  token: "fixture-session",
  did: "0".repeat(32),
  source: "h5",
  roles: [],
};
const role = {
  roleId: "10001",
  roleName: "测试",
  userId: "12",
  serverId: "cn",
  serverName: "国服",
};

test("role access tokens refresh once on 220 and remain isolated by role", async () => {
  let accessCalls = 0;
  let dataCalls = 0;
  const api = new KuroApi(async (url, options) => {
    expect(url.startsWith("https://api.kurobbs.com/")).toBe(true);
    expect(options.redirect).toBe("error");
    if (url.includes("requestToken"))
      return Response.json({
        code: 200,
        data: JSON.stringify({
          accessToken: `fixture-access-${++accessCalls}`,
        }),
      });
    dataCalls++;
    expect((options.headers as Record<string, string>)["B-At"]).toBe(`fixture-access-${accessCalls}`);
    return Response.json(dataCalls === 1 ? { code: 220 } : { code: 200, data: { value: 1 } });
  }, 0);
  expect(await api.roleRequest("/fixture", session, role)).toEqual({
    value: 1,
  });
  await api.roleRequest("/fixture", session, role);
  expect(accessCalls).toBe(2);
  await api.roleRequest("/fixture", session, { ...role, roleId: "10002" });
  expect(accessCalls).toBe(3);
  api.clearAccess(session.id);
  await api.roleRequest("/fixture", session, role);
  expect(accessCalls).toBe(4);
});

test("network errors and remote rejection text never leak credentials", async () => {
  const api = new KuroApi(async () => {
    throw new Error("fixture-session");
  }, 0);
  await expect(api.send("/fixture", session)).rejects.toThrow("请求失败");
  expect(() => api.success({ code: 123, data: "fixture-session" })).toThrow("123");
  await expect(api.send("//external.invalid", session)).rejects.toThrow("路径无效");
});

test("rejected legacy H5 authorization explains how to establish a client session", async () => {
  const api = new KuroApi(async () => Response.json({ code: 220 }), 0);
  await expect(api.roleRequest("/fixture", session, role)).rejects.toThrow("网页登录会话");
  await expect(api.roleRequest("/fixture", { ...session, source: "android" }, role)).rejects.toThrow("登录已失效");
});

test("cancelled requests do not consume a network call or the next rate-limit slot", async () => {
  const paths: string[] = [];
  const api = new KuroApi(async (url) => {
    paths.push(new URL(url).pathname);
    return Response.json({ code: 200, data: {} });
  }, 150);
  await api.send("/first", session);
  const controller = new AbortController();
  const stale = api.send("/stale", session, {}, { signal: controller.signal });
  const rejected = stale.then(() => false, () => true);
  await Bun.sleep(20);
  controller.abort();
  expect(await rejected).toBe(true);
  await api.send("/current", session);
  expect(paths).toEqual(["/first", "/current"]);
});

test("shutdown interrupts the rate-limit wait", async () => {
  const api = new KuroApi(async () => Response.json({ code: 200 }), 1500);
  await api.get("/first", session);
  const pending = api.get("/waiting", session);
  const rejected = pending.then(() => false, () => true);
  await Bun.sleep(20);
  const started = performance.now();
  api.cancel();
  expect(await rejected).toBe(true);
  expect(performance.now() - started).toBeLessThan(500);
});
