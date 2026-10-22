import { expect, test } from "bun:test";
import { AccountService } from "../../src/kujiequ/accounts.ts";
import { KuroApi } from "../../src/kujiequ/api.ts";
import { DailyService, parseDaily } from "../../src/kujiequ/daily.ts";
import type { AccountState } from "../../src/kujiequ/model.ts";

const role = {
  roleId: "10001",
  roleName: "测试",
  userId: "12",
  serverId: "cn",
  serverName: "国服",
};
const daily = {
  roleId: "10001",
  energyData: { name: "结晶波片", cur: 80, total: 240 },
  battlePassData: [{ name: "电台等级", value: "30" }],
  towerData: { name: "逆境深塔·深境区", img: "https://web-static.kurobbs.com/gamerdata/widget/game3/tower.png", cur: 12, total: 36 },
  slashTowerData: { name: "冥歌海墟·禁忌海域", img: "https://web-static.kurobbs.com/gamerdata/widget/game3/slashTower.png", cur: 0, total: 0 },
};

test("daily parser handles progress, battle pass and chest aliases without inventing missing values", () => {
  const view = parseDaily(
    daily,
    {
      id: "10001",
      level: 0,
      boxList: [{ location: "普通", num: 12 }],
      treasureBoxList: [{ boxName: "精密奇藏箱", num: 3 }],
      phantomBoxList: [{ boxName: "潮汐之遗·紫", num: 5 }],
    },
    role,
  );
  expect(view.metrics).toEqual([
    { name: "结晶波片", value: "80 / 240", icon: "energyData" },
    { name: "电台等级", value: "30", icon: "battlePassData" },
    {
      name: "逆境深塔·深境区",
      value: "12 / 36",
      icon: "towerData",
      iconUrl: "https://web-static.kurobbs.com/gamerdata/widget/game3/tower.png",
    },
    {
      name: "冥歌海墟·禁忌海域",
      value: "0 / 0",
      icon: "slashTowerData",
      iconUrl: "https://web-static.kurobbs.com/gamerdata/widget/game3/slashTower.png",
    },
  ]);
  expect(view.base).toEqual([{ name: "联觉等级", value: "0" }]);
  expect(view.boxes).toEqual([
    { name: "宝箱 · 普通", value: "12" },
    { name: "宝藏 · 精密奇藏箱", value: "3" },
    { name: "声骸 · 潮汐之遗·紫", value: "5" },
  ]);
  expect(() => parseDaily({ ...daily, roleId: "other" }, {}, role)).toThrow("不匹配");
  expect(() => parseDaily(null, {}, role)).toThrow("格式无效");
});

test("daily queries cache by role, use multipart base data and synchronize only on explicit action", async () => {
  const calls: string[] = [];
  const api = new KuroApi(async (url, options) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path.endsWith("requestToken"))
      return Response.json({
        code: 200,
        data: { accessToken: "fixture-access" },
      });
    if (path.endsWith("getData")) {
      const fields = new URL(url).searchParams;
      expect(fields.get("type")).toBe("2");
      expect(fields.get("sizeType")).toBe("1");
      expect(options.body).toBeUndefined();
      expect(new Headers(options.headers).get("token")).toBe("fixture-session");
      return Response.json({
        code: 200,
        data: JSON.stringify({ ...daily, roleId: fields.get("roleId") }),
      });
    }
    if (path.endsWith("baseData")) {
      expect(options.body).toBeInstanceOf(FormData);
      expect((options.body as FormData).has("userId")).toBe(false);
      return Response.json({ code: 200, data: { level: 60 } });
    }
    return Response.json({ code: 200 });
  }, 0);
  let state: AccountState = {
    accounts: [
      {
        id: "fixture",
        label: "测试",
        token: "fixture-session",
        did: "0".repeat(32),
        source: "h5",
        roles: [role, { ...role, roleId: "10002" }],
      },
    ],
    selectedAccountId: "fixture",
    selectedRoleId: "10001",
  };
  const accounts = new AccountService(api, {
    read: async () => structuredClone(state),
    write: async (next) => {
      state = structuredClone(next);
    },
  });
  const service = new DailyService(accounts, {
    read: async () => null,
    save: async () => {},
  });
  await service.load();
  await service.load();
  expect(calls.filter((path) => path.endsWith("getData"))).toHaveLength(1);
  expect(calls.some((path) => path.endsWith("refresh") || path.endsWith("refreshData"))).toBe(false);
  await accounts.select("fixture", "10002");
  expect((await service.load()).roleId).toBe("10002");
  await service.synchronize();
  expect(calls.slice(-4)).toEqual(["/gamer/widget/game3/refresh", "/aki/roleBox/akiBox/refreshData", "/gamer/widget/game3/getData", "/aki/roleBox/akiBox/baseData"]);
});
