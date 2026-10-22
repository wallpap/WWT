import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AccountService } from "../../src/kujiequ/accounts.ts";
import { KuroApi } from "../../src/kujiequ/api.ts";
import { SignService } from "../../src/kujiequ/sign.ts";
import { QueryCacheStore, queryScope } from "../../src/kujiequ/query-cache.ts";
import { CalculatorService } from "../../src/kujiequ/calculator.ts";
import type { AccountState } from "../../src/kujiequ/model.ts";

const initial = (): AccountState => ({
  accounts: [
    {
      id: "fixture",
      label: "测试",
      token: "fixture",
      did: "fixture",
      source: "android",
      roles: [
        {
          userId: "12",
          roleId: "10001",
          roleName: "测试",
          serverId: "cn",
          serverName: "国服",
        },
      ],
    },
  ],
  selectedAccountId: "fixture",
  selectedRoleId: "10001",
});

test("completed sign data survives restart, skips submission, refreshes explicitly and expires at China midnight", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-sign-cache-"));
  try {
    let now = Date.parse("2026-10-20T15:59:59Z"),
      requests = 0;
    const state = initial();
    const api = new KuroApi(async (url) => {
      requests++;
      return Response.json({
        code: 200,
        data: url.includes("initSignIn")
          ? {
              isSigIn: true,
              sigInNum: 1,
              signInGoodsConfigs: [{ goodsName: "星声", goodsNum: 20, goodsUrl: "https://example.com/astrite.png" }],
            }
          : [
              {
                orderCode: "1",
                sigInDate: "2026-10-20",
                goodsName: "星声",
                goodsNum: 20,
                goodsUrl: "https://example.com/astrite.png",
              },
            ],
      });
    }, 0);
    const accounts = new AccountService(api, {
      read: async () => structuredClone(state),
      write: async () => {},
    });
    const create = () => new SignService(accounts, { merge: async (_key, records) => records }, new QueryCacheStore(join(root, "cache.json")), () => now);
    const service = create();
    expect((await service.load()).signed).toBe(true);
    expect(requests).toBe(2);
    expect((await service.load()).cached).toBe(true);
    const restarted = create();
    const cached = await restarted.load();
    expect(cached.history).toHaveLength(1);
    expect(cached.history[0]?.iconUrl).toBe("https://example.com/astrite.png");
    expect(cached.rewards[0]?.iconUrl).toBe("https://example.com/astrite.png");
    expect((await restarted.submit("fixture", "10001", "cn")).submitted).toBe(false);
    expect(requests).toBe(2);
    await restarted.load(true);
    expect(requests).toBe(4);
    now += 1000;
    await restarted.load();
    expect(requests).toBe(6);
    state.accounts[0]!.roles[0]!.serverId = "other";
    await restarted.load();
    expect(requests).toBe(8);
    state.accounts[0]!.roles[0]!.userId = "13";
    await restarted.load();
    expect(requests).toBe(10);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsigned and incomplete sign data are queried again; concurrent complete loads share requests", async () => {
  let signed = false,
    failHistory = false,
    requests = 0;
  const accounts = new AccountService(
    new KuroApi(async (url) => {
      requests++;
      if (url.includes("initSignIn"))
        return Response.json({
          code: 200,
          data: { isSigIn: signed, sigInNum: 1, signInGoodsConfigs: [] },
        });
      if (failHistory) throw new Error("offline");
      return Response.json({ code: 200, data: [] });
    }, 0),
    { read: async () => initial(), write: async () => {} },
  );
  const service = new SignService(accounts, { merge: async (_key, records) => records }, { read: async () => null });
  await service.load();
  await service.load();
  expect(requests).toBe(4);
  signed = true;
  failHistory = true;
  await expect(service.load()).rejects.toThrow();
  expect(requests).toBe(6);
  failHistory = false;
  await Promise.all([service.load(), service.load()]);
  expect(requests).toBe(8);
  await service.load();
  expect(requests).toBe(8);
});

test("calculator reuses both persisted directories today and refreshes incomplete or old caches", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-directory-cache-"));
  try {
    let queries = 0;
    const accounts = new AccountService(
      new KuroApi(async (url) => {
        if (url.includes("requestToken")) return Response.json({ code: 200, data: { accessToken: "fixture" } });
        queries++;
        return Response.json({ code: 200, data: [] });
      }, 0),
      { read: async () => initial(), write: async () => {} },
    );
    const cache = new QueryCacheStore(join(root, "cache.json"));
    const { session, role } = await accounts.context();
    const scope = queryScope(session, role);
    await cache.save(scope, "calculator-roles", []);
    await new CalculatorService(accounts, cache).load();
    expect(queries).toBe(2);
    expect((await new CalculatorService(accounts, cache).load()).cached).toBe(true);
    expect(queries).toBe(2);
    await new CalculatorService(accounts, cache).load(true);
    expect(queries).toBe(4);
    const old = new QueryCacheStore(join(root, "old.json"));
    await old.save(scope, "calculator-roles", [], "", Date.now() - 86_400_000);
    await old.save(scope, "calculator-weapons", [], "", Date.now() - 86_400_000);
    await new CalculatorService(accounts, old).load();
    expect(queries).toBe(6);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
