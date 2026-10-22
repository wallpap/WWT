import { expect, test } from "bun:test";
import { BriefingService, parseBriefingPeriods, parseBriefingRecord } from "../../src/kujiequ/briefing.ts";
import { AccountService } from "../../src/kujiequ/accounts.ts";
import { KuroApi } from "../../src/kujiequ/api.ts";
import type { AccountState } from "../../src/kujiequ/model.ts";

const role = {
  roleId: "10001",
  roleName: "测试",
  userId: "12",
  serverId: "cn",
  serverName: "国服",
};

test("briefing parsers normalize period lists and resource totals", () => {
  expect(
    parseBriefingPeriods({
      weeks: [{ title: "第 1 周", index: 1 }],
      months: [],
      versions: [],
    }).weeks,
  ).toEqual([{ title: "第 1 周", index: "1" }]);
  expect(
    parseBriefingRecord({
      totalCoin: 1000,
      totalStar: 200,
      coinList: [{ type: "日常", num: 500 }],
      starList: [{ type: "活动", num: 200 }],
      copyWriting: "本期总结",
    }),
  ).toEqual({
    totalCoin: 1000,
    totalStar: 200,
    coinItems: [{ kind: "日常", count: 500 }],
    starItems: [{ kind: "活动", count: 200 }],
    description: "本期总结",
  });
  expect(() => parseBriefingPeriods({ weeks: [{ title: "缺少索引" }] })).toThrow("索引");
});

test("briefing service uses GET for periods and caches the selected detail", async () => {
  const calls: { method: string; path: string }[] = [];
  const api = new KuroApi(async (url, options) => {
    const path = new URL(url).pathname;
    calls.push({ method: String(options.method), path });
    if (path.endsWith("period/list"))
      return Response.json({
        code: 200,
        data: {
          weeks: [{ title: "周报", index: "1" }],
          months: [],
          versions: [],
        },
      });
    if (path.endsWith("requestToken")) return Response.json({ code: 200, data: { accessToken: "access" } });
    return Response.json({
      code: 200,
      data: { totalStar: 20, totalCoin: 100, starList: [], coinList: [] },
    });
  }, 0);
  let state: AccountState = {
    accounts: [
      {
        id: "fixture",
        label: "测试",
        token: "token",
        did: "did",
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
  const service = new BriefingService(accounts, {
    read: async () => null,
    save: async () => {},
    list: async () => [],
  });
  await service.periods();
  await service.detail("week", "1");
  await service.detail("week", "1");
  expect(calls.find((call) => call.path.endsWith("period/list"))?.method).toBe("GET");
  expect(calls.filter((call) => call.path.endsWith("/resource/week"))).toHaveLength(1);
});
