import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { QueryCacheStore } from "../../src/kujiequ/query-cache.ts";
import { DailyService } from "../../src/kujiequ/daily.ts";
import { BriefingService } from "../../src/kujiequ/briefing.ts";
import { CalculatorService } from "../../src/kujiequ/calculator.ts";
import { KuroApi } from "../../src/kujiequ/api.ts";
import { AccountService } from "../../src/kujiequ/accounts.ts";
import type { AccountState } from "../../src/kujiequ/model.ts";

test("live daily, calculator and briefing queries survive restart as scoped projected caches", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wwt-live-cache-"));
  try {
    const path = join(directory, "queries.json");
    const queries = new QueryCacheStore(path);
    const player = {
      roleId: "123",
      roleName: "玩家",
      userId: "12",
      serverId: "cn",
      serverName: "国服",
    };
    let calls = 0;
    const api = new KuroApi(async (url) => {
      calls++;
      const endpoint = new URL(url).pathname;
      let data: unknown = {};
      if (endpoint.endsWith("requestToken")) data = { accessToken: "fixture-access" };
      if (endpoint.endsWith("getData"))
        data = {
          roleId: "123",
          energyData: {
            name: "体力",
            img: "https://web-static.kurobbs.com/gamerdata/widget/game3/energy.png",
            cur: 120,
            total: 240,
          },
        };
      if (endpoint.endsWith("baseData")) data = { id: "123", level: 60, token: "must-not-persist" };
      if (endpoint.endsWith("period/list"))
        data = {
          weeks: [{ title: "第2周", index: "2" }],
          months: [],
          versions: [],
        };
      if (endpoint.endsWith("/resource/week")) data = { totalCoin: 100, totalStar: 2, token: "must-not-persist" };
      if (endpoint.endsWith("listRole")) data = [{ roleId: "101", roleName: "角色" }];
      if (endpoint.endsWith("listWeapon")) data = [{ weaponId: "201", weaponName: "武器" }];
      return Response.json({ code: 200, data });
    }, 0);
    const state: AccountState = {
      accounts: [
        {
          id: "fixture",
          label: "玩家",
          token: "fixture-session",
          did: "fixture-device",
          source: "h5",
          roles: [player],
        },
      ],
      selectedAccountId: "fixture",
      selectedRoleId: player.roleId,
    };
    const accounts = new AccountService(api, {
      read: async () => structuredClone(state),
      write: async () => {},
    });
    await new DailyService(accounts, queries).load();
    await new CalculatorService(accounts, queries).load();
    await new BriefingService(accounts, queries).detail("week", "2");
    const before = calls;
    const reopened = new QueryCacheStore(path);
    const savedDaily = await new DailyService(accounts, reopened).load(false, true);
    expect(savedDaily.metrics[0]!.value).toBe("120 / 240");
    expect(savedDaily.metrics[0]!.iconUrl).toBe("https://web-static.kurobbs.com/gamerdata/widget/game3/energy.png");
    expect((await new CalculatorService(accounts, reopened).load(false, true)).roles[0]!.name).toBe("角色");
    expect((await new BriefingService(accounts, reopened).detail("week", "2", false, true)).record.totalStar).toBe(2);
    expect(calls).toBe(before);
    expect(await reopened.read({ userId: "13", roleId: "123", serverId: "cn", source: "h5" }, "daily")).toBeNull();
    expect(await readFile(path, "utf8")).not.toContain("must-not-persist");
    expect(await readFile(path, "utf8")).not.toContain("fixture-session");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
