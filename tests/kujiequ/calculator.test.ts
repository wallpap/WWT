import { expect, test } from "bun:test";
import { buildRoleAim, buildWeaponAim, CalculatorService, parseCalculatorResult, parseCalculatorRoles, parseCalculatorWeapons } from "../../src/kujiequ/calculator.ts";
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
const skills = [1, 2, 3, 4, 5].map((startLevel) => ({
  startLevel,
  endLevel: 10,
}));

test("calculator parsers preserve directories and material groups", () => {
  expect(
    parseCalculatorRoles({
      data: [{ roleId: 1001, roleName: "漂泊者", starLevel: 5 }],
    })[0],
  ).toMatchObject({ id: "1001", name: "漂泊者", starLevel: 5 });
  expect(parseCalculatorWeapons([{ weaponId: 2001, weaponName: "测试武器", weaponStarLevel: 5 }])[0]?.id).toBe("2001");
  const result = parseCalculatorResult({
    roleNum: 1,
    preview: {
      allCost: [{ id: "1", name: "贝币", num: 100 }],
      missingCost: [{ id: "1", name: "贝币", num: 80 }],
      synthetic: [],
    },
    costList: [],
  });
  expect(result.preview.missingCost[0]?.count).toBe(80);
  expect(buildRoleAim("1001", 1, 90, skills, ["2-1", "3-5"])).toMatchObject({
    category: "all",
    skillLevelUpList: skills,
    advanceSkillList: ["2-1", "3-5"],
  });
  expect(buildWeaponAim("2001", 1, 90).weaponEndLevel).toBe(90);
  expect(() => buildWeaponAim("2001", 90, 1)).toThrow("无效");
});

test("calculator service loads both directories and submits structured content", async () => {
  const calls: { path: string; body: string }[] = [];
  const api = new KuroApi(async (url, options) => {
    const path = new URL(url).pathname;
    calls.push({
      path,
      body: options.body instanceof URLSearchParams ? options.body.toString() : "",
    });
    if (path.endsWith("requestToken")) return Response.json({ code: 200, data: { accessToken: "access" } });
    if (path.endsWith("listRole"))
      return Response.json({
        code: 200,
        data: [{ roleId: 1001, roleName: "角色" }],
      });
    if (path.endsWith("listWeapon"))
      return Response.json({
        code: 200,
        data: [{ weaponId: 2001, weaponName: "武器" }],
      });
    return Response.json({
      code: 200,
      data: {
        roleNum: 1,
        preview: { allCost: [], missingCost: [], synthetic: [] },
        costList: [],
      },
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
  const service = new CalculatorService(accounts, {
    read: async () => null,
    save: async () => {},
  });
  expect((await service.load()).roles[0]?.name).toBe("角色");
  await service.roleCost(buildRoleAim("1001", 1, 90, skills));
  expect(calls.some((call) => call.path.endsWith("batchRoleCost") && call.body.includes("content=%5B"))).toBe(true);
  const submitted = JSON.parse(new URLSearchParams(calls.find((call) => call.path.endsWith("batchRoleCost"))!.body).get("content")!) as unknown[];
  expect(submitted).toEqual([buildRoleAim("1001", 1, 90, skills)]);
  await expect(
    service.weaponCost({
      weaponId: "2001",
      weaponStartLevel: NaN,
      weaponEndLevel: 90,
    }),
  ).rejects.toThrow("无效");
  expect(calls.some((call) => call.path.endsWith("batchWeaponCost"))).toBe(false);
  await service.load(true);
  expect(calls.filter((call) => call.path.endsWith("listRole"))).toHaveLength(2);
  expect(calls.some((call) => call.path.endsWith("refreshData"))).toBe(false);
});

test("calculator rejects noninteger, nonfinite and descending targets", () => {
  for (const level of [NaN, Infinity, 2.5, 0, 91]) {
    expect(() => buildWeaponAim("2001", level, 90)).toThrow("无效");
    expect(() => buildRoleAim("1001", 1, level, skills)).toThrow("无效");
  }
  expect(() => buildRoleAim("1001", 1, 90, [{ startLevel: 8, endLevel: 7 }, ...skills.slice(1)])).toThrow("无效");
  expect(() => buildRoleAim("1001", 1, 90, skills, ["2-9"])).toThrow("无效");
});
