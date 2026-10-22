import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { summarizeBriefingHistory } from "../../src/kujiequ/briefing-history.ts";
import { BriefingService, type BriefingView } from "../../src/kujiequ/briefing.ts";
import { AccountService } from "../../src/kujiequ/accounts.ts";
import { KuroApi } from "../../src/kujiequ/api.ts";
import { QueryCacheStore } from "../../src/kujiequ/query-cache.ts";
import type { AccountState } from "../../src/kujiequ/model.ts";

test("history keeps the newest snapshot per period, orders numeric indices and compares one period type at a time", () => {
  const view = (index: string, totalStar: number, updatedAt: number, kind: BriefingView["kind"] = "week"): BriefingView => ({
    kind,
    period: { title: index, index },
    record: {
      totalCoin: totalStar * 10,
      totalStar,
      coinItems: [],
      starItems: [],
      description: "",
    },
    updatedAt,
  });
  const result = summarizeBriefingHistory([view("10", 200, 1), view("2", 90, 1), view("2", 100, 2), view("1", 1000, 1, "month")], "week");
  expect(result.rows.map((row) => row.view.period.index)).toEqual(["2", "10"]);
  expect(result.rows.map((row) => row.starChange)).toEqual([null, 100]);
  expect(result.totalStar).toBe(300);
  expect(result.averageStar).toBe(150);
  expect(result.totalCoin).toBe(3000);
});

test("history synchronization persists completed periods, resumes missing ones and remains isolated after a role change", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-briefing-history-"));
  try {
    const queries = new QueryCacheStore(join(root, "queries.json"));
    const role = {
      roleId: "123",
      roleName: "玩家",
      userId: "12",
      serverId: "cn",
      serverName: "国服",
    };
    let failed = false;
    const requested: string[] = [];
    const api = new KuroApi(async (url, options) => {
      const path = new URL(url).pathname;
      if (path.endsWith("period/list"))
        return Response.json({
          code: 200,
          data: {
            weeks: [1, 2, 3].map((index) => ({ title: `周${index}`, index })),
            months: [{ title: "月", index: "m" }],
            versions: [],
          },
        });
      if (path.endsWith("requestToken"))
        return Response.json({
          code: 200,
          data: { accessToken: "fixture-access" },
        });
      const period = (options.body as URLSearchParams).get("period")!;
      requested.push(period);
      if (!failed && period === "2") {
        failed = true;
        throw new Error("interrupted");
      }
      return Response.json({
        code: 200,
        data: { totalStar: Number(period) * 10, totalCoin: 100 },
      });
    }, 0);
    let state: AccountState = {
      accounts: [
        {
          id: "fixture",
          label: "玩家",
          token: "fixture-token",
          did: "fixture-device",
          source: "h5",
          roles: [role, { ...role, roleId: "456" }],
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
    const service = new BriefingService(accounts, queries);
    await expect(service.history("week", true)).rejects.toThrow("请求失败");
    expect((await service.history("week")).rows).toHaveLength(1);
    const result = await service.history("week", true);
    expect(result.totalStar).toBe(60);
    expect(requested).toEqual(["1", "2", "2", "3"]);
    await accounts.select("fixture", "456");
    expect((await service.history("week")).rows).toHaveLength(0);
    await expect(
      service.history("week", true, () => {
        state.selectedRoleId = "123";
      }),
    ).rejects.toThrow("角色已切换");
    await accounts.select("fixture", "456");
    expect((await service.history("week")).rows).toHaveLength(1);
    const reopened = new BriefingService(accounts, new QueryCacheStore(join(root, "queries.json")));
    expect((await reopened.history("week")).totalStar).toBe(10);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
