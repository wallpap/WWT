import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChallengeHistoryStore, challengeSnapshots } from "../../src/kujiequ/challenge-history.ts";
import { challengeDeadline, parseTower, parseSlash, parseNewTower, type ChallengeView } from "../../src/kujiequ/challenge.ts";

const observedAt = Date.UTC(2026, 9, 19);
const endTime = observedAt + 7 * 86400000;
const view = (updatedAt = observedAt, end = endTime): ChallengeView => ({
  roleId: "1001",
  roleName: "测试",
  updatedAt,
  tower: parseTower({
    isUnlock: true,
    seasonEndTime: end,
    difficultyList: [
      {
        towerAreaList: [
          {
            areaName: "测试塔",
            star: 6,
            maxStar: 12,
            floorList: [{ floor: 1, star: 3, roleList: [{ roleId: 101 }] }],
          },
        ],
      },
    ],
  }),
  slash: parseSlash({ isUnlock: true, seasonEndTime: end, difficultyList: [] }),
  newTower: parseNewTower({ isUnlock: true, endTime: end, modeDetails: [] }),
});

test("team roles, skill branches and buff details survive offline history without persisting extra response fields", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wwt-challenge-teams-")),
    path = join(directory, "history.json");
  try {
    const snapshot = view();
    snapshot.slash = parseSlash({
      isUnlock: true,
      seasonEndTime: endTime,
      difficultyList: [
        {
          challengeList: [
            {
              halfList: [
                {
                  score: 100,
                  buffName: "暴击提升",
                  buffDescription: "暴击提升 20%",
                  buffQuality: 5,
                  roleList: [
                    {
                      roleId: 101,
                      iconUrl: "https://example.invalid/101.png",
                      token: "fixture-hidden",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    snapshot.newTower = parseNewTower({
      isUnlock: true,
      endTime,
      modeDetails: [
        {
          modeId: 1,
          teams: [
            {
              round: 3,
              bossCount: 5,
              passBoss: 4,
              roleList: [{ roleId: 102, skillBranchIndex: 2 }],
              roleIcons: ["https://example.invalid/102.png"],
              buffs: [
                {
                  buffId: 10,
                  buffName: "伤害提升",
                  desc: "伤害提升 30%",
                  token: "fixture-hidden",
                },
              ],
            },
          ],
        },
      ],
    });
    const store = new ChallengeHistoryStore(path);
    await store.merge("account", snapshot);
    const saved = await new ChallengeHistoryStore(path).list("account");
    const slash = saved.find((item) => item.kind === "slash"),
      matrix = saved.find((item) => item.kind === "new-tower");
    expect(slash?.kind === "slash" && slash.data.difficulties[0]?.challenges[0]?.halves[0]?.buffs?.[0]).toMatchObject({
      name: "暴击提升",
      description: "暴击提升 20%",
      quality: 5,
    });
    expect(matrix?.kind === "new-tower" && matrix.data.modes[0]?.teams[0]).toMatchObject({
      bossCount: 5,
      roles: [
        {
          id: "102",
          iconUrl: "https://example.invalid/102.png",
          skillBranch: 2,
        },
      ],
      buffs: [{ id: "10", description: "伤害提升 30%" }],
    });
    expect(await readFile(path, "utf8")).not.toContain("fixture-hidden");
    const previous = view();
    delete previous.tower.areas[0]!.floors[0]!.roles;
    await store.merge("previous-version", previous);
    expect(await store.list("previous-version")).toHaveLength(3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("challenge deadlines use milliseconds remaining and preserve imported absolute timestamps", () => {
  expect(challengeDeadline(3600000, observedAt)).toBe(observedAt + 3600000);
  expect(challengeDeadline(30 * 86400000, observedAt)).toBe(observedAt + 30 * 86400000);
  expect(parseTower({ seasonEndTime: 3600000 }, observedAt).seasonEndTime).toBe(observedAt + 3600000);
  expect(parseSlash({ seasonEndTime: 3600000 }, observedAt).seasonEndTime).toBe(observedAt + 3600000);
  expect(parseNewTower({ endTime: 3600000 }, observedAt).endTime).toBe(observedAt + 3600000);
  expect(challengeDeadline(endTime, observedAt)).toBe(endTime);
  expect(challengeDeadline(0, observedAt)).toBe(0);
});

test("history persists seasons and isolates accounts while refreshing a period without duplicates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wwt-challenge-history-"));
  const path = join(directory, "history.json");
  try {
    const store = new ChallengeHistoryStore(path);
    await Promise.all([store.merge("account-A", view()), store.merge("account-B", view())]);
    const refreshed = view(observedAt + 1000, endTime + 1000);
    refreshed.tower.areas[0]!.stars = 9;
    await store.merge("account-A", refreshed);
    await store.merge("account-A", view(observedAt - 1000));
    await store.merge("account-A", view(observedAt + 2000, endTime + 14 * 86400000));
    const restored = await new ChallengeHistoryStore(path).list("account-A");
    expect(restored).toHaveLength(6);
    const prior = restored.find((row) => row.kind === "tower" && row.endTime === endTime);
    expect(prior?.kind === "tower" && prior.data.areas[0]?.stars).toBe(9);
    expect(await store.list("account-B")).toHaveLength(3);
    expect(await store.list("unknown")).toEqual([]);
    expect(
      challengeSnapshots({
        ...view(),
        tower: parseTower({}),
        slash: parseSlash({}),
        newTower: parseNewTower({}),
      }),
    ).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid stored history is preserved and does not get replaced by a refresh", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wwt-challenge-corrupt-"));
  const path = join(directory, "history.json");
  try {
    const store = new ChallengeHistoryStore(path);
    await writeFile(path, "broken json");
    await expect(store.merge("account-A", view())).rejects.toThrow("读取本地挑战历史失败");
    expect(await readFile(path, "utf8")).toBe("broken json");
    await writeFile(
      path,
      JSON.stringify({
        "account-A": [
          {
            ...challengeSnapshots(view())[0],
            data: {
              unlocked: true,
              seasonEndTime: endTime,
              areas: [{ stars: "bad" }],
            },
          },
        ],
      }),
    );
    await expect(store.list("account-A")).rejects.toThrow("格式无效");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
