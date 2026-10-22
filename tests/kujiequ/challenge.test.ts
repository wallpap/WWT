import { expect, test } from "bun:test";
import { ChallengeService, parseNewTower, parseSlash, parseTower } from "../../src/kujiequ/challenge.ts";
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

test("challenge parsers normalize tower, slash and new tower records", () => {
  expect(
    parseTower({
      isUnlock: true,
      seasonEndTime: 1710000000000,
      difficultyList: [
        {
          towerAreaList: [
            {
              areaName: "一区",
              star: 8,
              maxStar: 12,
              floorList: [{ floor: 1, star: 3, roleList: [{ roleId: 1 }] }],
            },
          ],
        },
      ],
    }),
  ).toMatchObject({
    unlocked: true,
    areas: [{ name: "一区", floors: [{ floor: "1", roleCount: 1 }] }],
  });
  expect(
    parseSlash({
      difficultyList: [
        {
          difficultyName: "困难",
          allScore: 80,
          maxScore: 100,
          challengeList: [
            {
              challengeName: "第一关",
              score: 80,
              rank: "S",
              halfList: [{ buffName: "增益", score: 40, roleList: [] }],
            },
          ],
        },
      ],
    }),
  ).toMatchObject({
    difficulties: [{ challenges: [{ name: "第一关", halves: [{ name: "增益" }] }] }],
  });
  expect(
    parseNewTower({
      isUnlock: true,
      reward: 20,
      totalReward: 30,
      modeDetails: [
        {
          modeId: 1,
          score: 100,
          rank: 2,
          teams: [{ score: 100, roleIcons: ["a", "b"] }],
        },
      ],
    }),
  ).toMatchObject({ reward: 20, modes: [{ teams: [{ roleCount: 2 }] }] });
});

test("challenge service queries three endpoints once and caches by selected role", async () => {
  const calls: string[] = [];
  const requests = new Map<string, { url: URL; options: RequestInit }>();
  const api = new KuroApi(async (url, options) => {
    const path = new URL(url).pathname;
    calls.push(path);
    requests.set(path.split("/").at(-1)!, { url: new URL(url), options });
    if (path.endsWith("requestToken")) return Response.json({ code: 200, data: { accessToken: "access" } });
    if (path.endsWith("towerDataDetail")) return Response.json({ code: 200, data: { difficultyList: [] } });
    if (path.endsWith("slashDetail")) return Response.json({ code: 200, data: { difficultyList: [] } });
    if (path.endsWith("newTowerDetail")) return Response.json({ code: 200, data: { modeDetails: [] } });
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
  const scopes: string[] = [];
  const service = new ChallengeService(accounts, {
    merge: async (key) => {
      scopes.push(key);
    },
    list: async (key) => {
      scopes.push(key);
      return [];
    },
  });
  await service.load();
  await service.load();
  expect(calls.filter((path) => path.endsWith("towerDataDetail"))).toHaveLength(1);
  expect(calls.filter((path) => path.endsWith("slashDetail"))).toHaveLength(1);
  expect(calls.filter((path) => path.endsWith("newTowerDetail"))).toHaveLength(1);
  for (const path of ["towerDataDetail", "newTowerDetail"]) {
    const request = requests.get(path)!.options;
    expect(request.body).toBeInstanceOf(FormData);
    expect((request.body as FormData).get("roleId")).toBe(role.roleId);
    expect(new Headers(request.headers).get("source")).toBe("android");
  }
  const slash = requests.get("slashDetail")!;
  expect(slash.url.searchParams.get("roleId")).toBe(role.roleId);
  expect(slash.url.searchParams.get("serverId")).toBe(role.serverId);
  expect(slash.options.body).toBeUndefined();
  expect(new Headers(slash.options.headers).get("B-At")).toBe("access");
  expect(await service.history()).toEqual([]);
  expect(scopes).toEqual([JSON.stringify(["fixture", role.roleId, role.serverId]), JSON.stringify(["fixture", role.roleId, role.serverId])]);
});
