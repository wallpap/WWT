import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CalculatorTargetStore } from "../../src/kujiequ/calculator-targets.ts";
import { buildRoleAim, buildWeaponAim, CalculatorService } from "../../src/kujiequ/calculator.ts";
import { AccountService } from "../../src/kujiequ/accounts.ts";
import { KuroApi } from "../../src/kujiequ/api.ts";
import type { AccountState } from "../../src/kujiequ/model.ts";

const skills = Array.from({ length: 5 }, () => ({
  startLevel: 1,
  endLevel: 8,
}));

test("saved targets survive a restart, update individually, serialize concurrent edits and isolate game roles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wwt-targets-"));
  try {
    const path = join(directory, "targets.json");
    const store = new CalculatorTargetStore(path);
    const aim = {
      ...buildRoleAim("101", 1, 80, skills),
      token: "never-store-this",
      skillLevelUpList: skills.map((skill) => ({
        ...skill,
        token: "never-store-this",
      })),
    };
    await Promise.all([
      store.save("player-a", { kind: "role", aim }),
      store.save("player-a", {
        kind: "weapon",
        aim: buildWeaponAim("201", 1, 90),
      }),
    ]);
    await store.save("player-b", {
      kind: "role",
      aim: buildRoleAim("102", 20, 70, skills),
    });
    await store.save("player-a", {
      kind: "role",
      aim: buildRoleAim("101", 40, 90, skills, ["2-1"]),
    });
    const reopened = new CalculatorTargetStore(path);
    expect(await reopened.list("player-a")).toMatchObject({
      roles: [
        {
          roleId: "101",
          roleStartLevel: 40,
          roleEndLevel: 90,
          advanceSkillList: ["2-1"],
        },
      ],
      weapons: [{ weaponId: "201" }],
    });
    expect((await reopened.list("player-b")).roles[0]!.roleId).toBe("102");
    expect(await readFile(path, "utf8")).not.toContain("never-store-this");
    await reopened.remove("player-a", "role", "101");
    expect((await reopened.list("player-a")).weapons).toHaveLength(1);
    const before = await readFile(path, "utf8");
    await expect(
      reopened.save("player-a", {
        kind: "weapon",
        aim: { weaponId: "201", weaponStartLevel: 99, weaponEndLevel: 90 },
      }),
    ).rejects.toThrow("无效");
    expect(await readFile(path, "utf8")).toBe(before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a batch submits all validated targets in one request and preserves the server's combined inventory result", async () => {
  const contents: unknown[] = [];
  const api = new KuroApi(async (url, options) => {
    if (new URL(url).pathname.endsWith("requestToken"))
      return Response.json({
        code: 200,
        data: { accessToken: "fixture-access" },
      });
    const content = JSON.parse((options.body as URLSearchParams).get("content")!);
    contents.push(content);
    return Response.json({
      code: 200,
      data: {
        roleNum: 2,
        preview: {
          allCost: [{ id: "1", name: "贝币", num: 200 }],
          missingCost: [{ id: "1", name: "贝币", num: 120 }],
          synthetic: [],
        },
      },
    });
  }, 0);
  const role = {
    roleId: "123",
    roleName: "玩家",
    userId: "u",
    serverId: "cn",
    serverName: "国服",
  };
  const state: AccountState = {
    accounts: [
      {
        id: "fixture",
        label: "测试",
        token: "fixture-token",
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
  const aims = [buildRoleAim("101", 1, 90, skills), buildRoleAim("102", 30, 80, skills)];
  const result = await service.roleCosts(aims);
  expect(contents).toEqual([aims]);
  expect(result.preview.missingCost[0]!.count).toBe(120);
  await expect(service.roleCosts([])).rejects.toThrow("添加角色");
  await expect(service.weaponCosts([buildWeaponAim("201", 1, 90), { weaponId: "202", weaponStartLevel: 91, weaponEndLevel: 90 }])).rejects.toThrow("无效");
  expect(contents).toHaveLength(1);
  const weapons = [buildWeaponAim("201", 1, 90), buildWeaponAim("202", 20, 70)];
  await service.weaponCosts(weapons);
  expect(contents[1]).toEqual(weapons);
});
