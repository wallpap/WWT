import { expect, test } from "bun:test";
import { AutoSignService, nextAutoSignTime } from "../../src/kujiequ/auto-sign.ts";
import type { SignTarget } from "../../src/kujiequ/sign.ts";

test("automatic sign-in handles startup new roles the China midnight boundary and missed ticks", async () => {
  let now = Date.parse("2026-10-20T23:59:00+08:00"),
    enabled = false;
  const first: SignTarget = {
    accountId: "account",
    roleId: "1",
    serverId: "cn",
    roleName: "fixture",
  };
  const targets = [first];
  const signed: string[] = [];
  const service = new AutoSignService(
    {
      batchTargets: async () => [...targets],
      submitBatch: async (expected, shouldSign) =>
        expected
          .filter((target) => shouldSign?.(target))
          .map((target) => {
            signed.push(target.roleId);
            return {
              target,
              error: null,
              result: { submitted: true, view: null, message: "签到成功" },
            };
          }),
    },
    () => enabled,
    () => {},
    () => now,
  );
  await service.tick();
  expect(signed).toEqual([]);
  enabled = true;
  await service.tick();
  await service.tick();
  expect(signed).toEqual(["1"]);
  targets.push({ ...first, roleId: "2" });
  await service.tick();
  expect(signed).toEqual(["1", "2"]);
  now = Date.parse("2026-10-21T00:01:00+08:00");
  await service.tick();
  expect(signed).toHaveLength(2);
  expect(service.status().nextRun).toBe("2026-10-20T16:05:00.000Z");
  now = Date.parse("2026-10-21T00:05:00+08:00");
  await service.tick();
  expect(signed).toEqual(["1", "2", "1", "2"]);
  expect(service.status().nextRun).toBe("2026-10-21T16:05:00.000Z");
  now = Date.parse("2026-10-22T10:00:00+08:00");
  await service.tick();
  expect(signed).toHaveLength(6);
  enabled = false;
  await service.tick();
  expect(service.status().nextRun).toBeNull();
  service.stop();
  enabled = true;
  targets.push({ ...first, roleId: "3" });
  await service.tick();
  expect(signed).toHaveLength(6);
  expect(nextAutoSignTime(Date.parse("2026-10-21T00:03:00+08:00"))).toBe("2026-10-20T16:05:00.000Z");
});

test("disabling automatic sign-in during a batch skips subsequent roles and does not overlap batches", async () => {
  let enabled = true,
    calls = 0;
  let entered!: () => void, resume!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const target: SignTarget = {
    accountId: "account",
    roleId: "1",
    serverId: "cn",
    roleName: "fixture",
  };
  const service = new AutoSignService(
    {
      batchTargets: async () => [target],
      submitBatch: async (expected, shouldSign) => {
        calls++;
        entered();
        await gate;
        expect(shouldSign?.(expected[0]!)).toBe(false);
        return [];
      },
    },
    () => enabled,
  );
  const pending = service.tick();
  await waiting;
  await service.tick();
  expect(calls).toBe(1);
  enabled = false;
  resume();
  await pending;
  expect(service.status().running).toBe(false);
});
