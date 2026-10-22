import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountService } from "../../src/kujiequ/accounts.ts";
import { KuroApi } from "../../src/kujiequ/api.ts";
import { SignService } from "../../src/kujiequ/sign.ts";
import { SignHistoryStore } from "../../src/kujiequ/sign-store.ts";
import type { AccountState } from "../../src/kujiequ/model.ts";

function setup(mode: "normal" | "timeout" | "refresh-failure" = "normal", multi = false) {
  const signedRoles = new Set<string>();
  let writes = 0;
  const api = new KuroApi(async (url, options) => {
    const request = new URL(url);
    expect(options.body).toBeUndefined();
    const roleId = request.searchParams.get("roleId")!;
    expect(roleId).toMatch(/^1000[12]$/);
    const signed = signedRoles.has(roleId);
    if (request.pathname.endsWith("/v2")) {
      writes++;
      expect(request.searchParams.get("reqMonth")).toMatch(/^\d{2}$/);
      if (mode === "timeout") throw new Error("fixture-session");
      signedRoles.add(roleId);
      return Response.json({ code: 200 });
    }
    if (mode === "refresh-failure" && signed) throw new Error("network");
    return Response.json({
      code: 200,
      data: request.pathname.includes("initSignIn")
        ? {
            isSigIn: signed,
            sigInNum: signed ? 1 : 0,
            signInGoodsConfigs: [{ goodsName: "星声", goodsNum: 20 }],
          }
        : signed
          ? [
              {
                orderCode: 1,
                sigInDate: "2026-10-19",
                goodsName: "星声",
                goodsNum: 20,
              },
            ]
          : [],
    });
  }, 0);
  const state: AccountState = {
    accounts: [
      {
        id: "fixture",
        label: "测试",
        token: "fixture-session",
        did: "0".repeat(32),
        source: "h5",
        roles: [
          {
            roleId: "10001",
            roleName: "测试",
            userId: "12",
            serverId: "cn",
            serverName: "国服",
          },
        ],
      },
    ],
    selectedAccountId: "fixture",
    selectedRoleId: "10001",
  };
  if (multi)
    state.accounts.push({
      ...state.accounts[0]!,
      id: "second",
      roles: [{ ...state.accounts[0]!.roles[0]!, roleId: "10002", userId: "13" }],
    });
  const accounts = new AccountService(api, {
    read: async () => structuredClone(state),
    write: async () => {},
  });
  return {
    service: new SignService(accounts, { merge: async (_key, records) => records }, { read: async () => null }),
    writes: () => writes,
  };
}

test("batch signs exactly the previewed accounts without changing selected role and rejects changed lists", async () => {
  const { service, writes } = setup("normal", true);
  const targets = await service.batchTargets();
  expect(targets).toHaveLength(2);
  await expect(service.submitBatch(targets.slice(0, 1))).rejects.toThrow("列表已变化");
  expect(writes()).toBe(0);
  const results = await service.submitBatch(targets);
  expect(results.every((item) => item.result?.submitted)).toBe(true);
  expect(writes()).toBe(2);
  expect((await service.load()).roleId).toBe("10001");
});

test("reading sign status never submits; explicit sign updates rewards/history and skips already signed roles", async () => {
  const { service, writes } = setup();
  expect((await service.load()).signed).toBe(false);
  expect(writes()).toBe(0);
  const result = await service.submit("fixture", "10001", "cn");
  expect(result.submitted).toBe(true);
  expect(result.view?.signed).toBe(true);
  expect(result.view?.rewards[0]?.received).toBe(true);
  expect(result.view?.history[0]?.name).toBe("星声");
  expect((await service.submit("fixture", "10001", "cn")).submitted).toBe(false);
  expect(writes()).toBe(1);
});

test("the shared batch service stops sending requests when the automatic policy is disabled", async () => {
  const { service, writes } = setup("normal", true);
  const targets = await service.batchTargets();
  const results = await service.submitBatch(targets, () => writes() === 0);
  expect(writes()).toBe(1);
  expect(results).toHaveLength(1);
});

test("changed targets and overlapping submissions cannot send extra sign requests", async () => {
  const { service, writes } = setup();
  await expect(service.submit("other", "10001", "cn")).rejects.toThrow("已切换");
  const first = service.submit("fixture", "10001", "cn");
  await expect(service.submit("fixture", "10001", "cn")).rejects.toThrow("正在签到");
  await first;
  expect(writes()).toBe(1);
});

test("uncertain writes are not retried; successful writes stay successful when refresh fails", async () => {
  const uncertain = setup("timeout");
  await expect(uncertain.service.submit("fixture", "10001", "cn")).rejects.toThrow("结果未确认");
  expect(uncertain.writes()).toBe(1);
  const success = setup("refresh-failure");
  expect(await success.service.submit("fixture", "10001", "cn")).toMatchObject({
    submitted: true,
    view: null,
    message: "签到已成功，状态或历史刷新失败，请点击刷新状态",
  });
  expect(success.writes()).toBe(1);
});

test("sign history persists across queries, deduplicates orders and isolates players", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wwt-sign-"));
  try {
    const store = new SignHistoryStore(join(directory, "history.json"));
    const record = {
      orderCode: "1",
      date: "2026-10-19",
      name: "星声",
      count: "20",
    };
    const withImage = { ...record, iconUrl: "https://example.com/astrite.png" };
    await store.merge("a", [withImage]);
    await store.merge("b", [{ ...record, name: "贝币" }]);
    expect(await store.merge("a", [record])).toEqual([withImage]);
    expect(await new SignHistoryStore(join(directory, "history.json")).merge("a", [])).toEqual([withImage]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
