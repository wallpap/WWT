import { expect, test } from "bun:test";
import { parseOwnedRoles, parseRoleDetail, RoleService } from "../../src/kujiequ/role.ts";
import { AccountService } from "../../src/kujiequ/accounts.ts";
import { KuroApi } from "../../src/kujiequ/api.ts";
import type { AccountState } from "../../src/kujiequ/model.ts";

const accountRole = {
  roleId: "10001",
  roleName: "测试账号",
  userId: "12",
  serverId: "cn",
  serverName: "国服",
};
const owned = {
  roleId: 101,
  roleName: "漂泊者",
  level: 80,
  breach: 6,
  chainUnlockNum: 2,
  starLevel: 5,
  attributeName: "湮灭",
  weaponTypeName: "迅刀",
  roleIconUrl: "icon",
  rolePicUrl: "pic",
};

test("role parser validates ownership and preserves nested equipment data", () => {
  const roles = parseOwnedRoles({
    roleList: [owned, { ...owned, roleId: 102, roleName: "秧秧", level: 70 }],
  });
  expect(roles[0]).toMatchObject({
    roleId: "101",
    name: "漂泊者",
    level: 80,
    chainUnlocked: 2,
  });
  const detail = parseRoleDetail(
    {
      role: owned,
      level: 80,
      roleAttributeList: [{ attributeName: "生命", attributeValue: "12345" }],
      chainList: [{ order: 1, name: "第一链", unlocked: true, description: "提升伤害" }],
      skillList: [
        {
          level: 10,
          skill: { type: "共鸣技能", name: "测试技能", description: "描述" },
        },
      ],
      weaponData: {
        level: 90,
        breach: 6,
        resonLevel: 2,
        weapon: { weaponName: "测试武器", weaponStarLevel: 5 },
      },
      phantomData: {
        equipPhantomList: [
          null,
          {
            level: 25,
            quality: 5,
            cost: 4,
            phantomProp: { name: "无常凶鹭" },
            mainProps: [{ attributeName: "暴击", attributeValue: "10%" }],
          },
        ],
      },
    },
    roles[0]!,
  );
  expect(detail.phantoms).toHaveLength(1);
  expect(detail.skills).toHaveLength(1);
  expect(detail.attributes).toHaveLength(1);
  expect(detail.weapon?.name).toBe("测试武器");
  expect(detail.phantoms[0]?.mainProps[0]?.value).toBe("10%");
  expect(() => parseRoleDetail({ role: { ...owned, roleId: 999 } }, roles[0]!)).toThrow("不匹配");
});

test("role service caches owned list and selected detail per account role", async () => {
  const calls: string[] = [];
  const bodies: RequestInit[] = [];
  const api = new KuroApi(async (url, options) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path.endsWith("requestToken")) return Response.json({ code: 200, data: { accessToken: "access" } });
    bodies.push(options);
    if (path.endsWith("roleData")) return Response.json({ code: 200, data: { roleList: [owned] } });
    if (path.endsWith("getRoleDetail")) return Response.json({ code: 200, data: { role: owned, level: 80 } });
    return Response.json({ code: 200, data: {} });
  }, 0);
  let state: AccountState = {
    accounts: [
      {
        id: "fixture",
        label: "测试",
        token: "token",
        did: "did",
        source: "h5",
        roles: [accountRole],
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
  const service = new RoleService(accounts, {
    read: async () => null,
    saveList: async () => {},
    saveDetail: async () => {},
  });
  const first = await service.load();
  const second = await service.load();
  expect(first.detail?.roleId).toBe("101");
  expect(second.roles).toHaveLength(1);
  expect(calls.filter((path) => path.endsWith("roleData"))).toHaveLength(1);
  expect(calls.filter((path) => path.endsWith("getRoleDetail"))).toHaveLength(1);
  await service.load(true);
  expect(calls.filter((path) => path.endsWith("roleData"))).toHaveLength(2);
  expect(calls.filter((path) => path.endsWith("getRoleDetail"))).toHaveLength(2);
  for (const request of bodies) {
    expect(request.body).toBeInstanceOf(FormData);
    expect((request.body as FormData).get("roleId")).toBe(accountRole.roleId);
    expect((request.body as FormData).get("gameId")).toBe("3");
    expect(new Headers(request.headers).get("source")).toBe("android");
  }
  expect((bodies[1]?.body as FormData).get("id")).toBe("101");
});
