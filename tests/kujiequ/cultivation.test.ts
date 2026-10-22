import { expect, test } from "bun:test";
import { parseRoleCultivation } from "../../src/kujiequ/cultivation.ts";
import { CalculatorService } from "../../src/kujiequ/calculator.ts";
import { AccountService } from "../../src/kujiequ/accounts.ts";
import { KuroApi } from "../../src/kujiequ/api.ts";
import type { AccountState } from "../../src/kujiequ/model.ts";

const cultivation = {
  roleId: 101,
  roleLevel: 80,
  skillLevelList: ["常态攻击", "共鸣技能", "共鸣解放", "变奏技能", "共鸣回路", "延奏技能", "谐度破坏"].map((type, index) => ({ type, level: [2, 3, 4, 5, 7, 1, 1][index]! })),
  skillBreakList: ["2-1", "3-3"],
};

test("cultivation preserves role ownership and translates API skill order to calculator order", () => {
  expect(parseRoleCultivation([cultivation], "101")).toEqual({
    roleId: "101",
    roleLevel: 80,
    skillLevels: [2, 3, 7, 4, 5],
    unlockedNodes: ["2-1", "3-3"],
  });
  expect(parseRoleCultivation([{ ...cultivation, skillLevelList: [...cultivation.skillLevelList].reverse() }], "101").skillLevels).toEqual([2, 3, 7, 4, 5]);
  expect(() => parseRoleCultivation([cultivation], "102")).toThrow("没有该角色");
  expect(() => parseRoleCultivation([{ ...cultivation, skillLevelList: [{ type: "常态攻击", level: 1 }] }], "101")).toThrow("等级无效");
  expect(() => parseRoleCultivation([{ ...cultivation, skillBreakList: ["2-6"] }], "101")).toThrow("格式无效");
});

test("cultivation synchronization sends the chosen account and role as query parameters", async () => {
  const role = {
    roleId: "10001",
    roleName: "测试账号",
    userId: "12",
    serverId: "cn",
    serverName: "国服",
  };
  const api = new KuroApi(async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("requestToken"))
      return Response.json({
        code: 200,
        data: { accessToken: "fixture-access" },
      });
    expect(parsed.pathname).toBe("/aki/calculator/roleCultivateStatus");
    expect(Object.fromEntries(parsed.searchParams)).toMatchObject({
      ids: "101",
      roleId: "10001",
      userId: "12",
      serverId: "cn",
    });
    expect(options.body).toBeUndefined();
    expect(new Headers(options.headers).get("B-At")).toBe("fixture-access");
    return Response.json({ code: 200, data: [cultivation] });
  }, 0);
  const state: AccountState = {
    accounts: [
      {
        id: "fixture",
        label: "测试",
        token: "fixture-session",
        did: "fixture-device",
        source: "h5",
        roles: [role],
      },
    ],
    selectedAccountId: "fixture",
    selectedRoleId: role.roleId,
  };
  const service = new CalculatorService(
    new AccountService(api, {
      read: async () => structuredClone(state),
      write: async () => {},
    }),
  );
  expect((await service.cultivation("101")).skillLevels).toEqual([2, 3, 7, 4, 5]);
});
