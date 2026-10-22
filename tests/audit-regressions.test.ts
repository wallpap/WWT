import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KuroApi } from "../src/kujiequ/api.ts";
import { DailyService } from "../src/kujiequ/daily.ts";
import { AccountService } from "../src/kujiequ/accounts.ts";
import { mergeGameTimeRecords } from "../src/game-time/log-import.ts";
import { checkLocalResources } from "../src/game/resource-check.ts";
import { installOfficialResources } from "../src/game/resource-update.ts";
import { ResourceTransaction } from "../src/game/resource-transaction.ts";

const role = {
  roleId: "10001",
  roleName: "测试",
  userId: "12",
  serverId: "cn",
  serverName: "国服",
};
const session = {
  id: "audit",
  label: "测试",
  token: "fixture-token",
  did: "fixture-device",
  source: "h5" as const,
  roles: [role],
};

test("parallel role queries share authorization and shutdown aborts active and queued requests", async () => {
  let authorizations = 0;
  const api = new KuroApi(
    async (url) =>
      Response.json({
        code: 200,
        data: url.includes("requestToken") ? { accessToken: `access-${++authorizations}` } : {},
      }),
    0,
  );
  await Promise.all([1, 2, 3].map(() => api.roleRequest("/fixture", session, role)));
  expect(authorizations).toBe(1);
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let sent = 0;
  const blocked = new KuroApi(async (_url, options) => {
    sent++;
    started();
    return new Promise((_resolve, reject) => options.signal!.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
  }, 0);
  const results = Promise.allSettled([blocked.send("/fixture", session), blocked.send("/fixture", session)]);
  await ready;
  blocked.cancel();
  expect((await results).map((result) => result.status)).toEqual(["rejected", "rejected"]);
  expect(sent).toBe(1);
});

test("successful daily response survives a failed cache write", async () => {
  const api = new KuroApi(
    async (url) =>
      Response.json({
        code: 200,
        data: url.includes("requestToken") ? { accessToken: "fixture" } : {},
      }),
    0,
  );
  const state = {
    accounts: [session],
    selectedAccountId: session.id,
    selectedRoleId: role.roleId,
  };
  const accounts = new AccountService(api, {
    read: async () => state,
    write: async () => {},
  });
  const daily = new DailyService(accounts, {
    read: async () => null,
    save: async () => {
      throw new Error("disk full");
    },
  });
  expect((await daily.load(true)).roleId).toBe(role.roleId);
});

test("log import assigns an automatic session while preserving a manual session", () => {
  const record = {
    roleId: null,
    gameDate: "2026-10-20",
    startTime: 1000,
    endTime: 3601000,
    duration: 3600000,
  };
  const merged = mergeGameTimeRecords(
    [
      { ...record, id: 1, source: "auto" },
      { ...record, id: 2 },
    ],
    [{ ...record, roleId: "10001", source: "log" }],
  );
  expect(merged.records.length).toBe(2);
  expect(merged.records[0]?.roleId).toBe("10001");
  expect(merged.records[1]?.roleId).toBe(null);
});

test("cancelled preparation stops before filesystem checks and failed commit guard preserves files", async () => {
  await expect(
    checkLocalResources("missing-directory", [], {
      signal: AbortSignal.abort(),
    }),
  ).rejects.toThrow();
  const root = await mkdtemp(join(tmpdir(), "wwt-audit-commit-"));
  try {
    await writeFile(join(root, "game.dat"), "old");
    await expect(
      installOfficialResources(
        root,
        [
          {
            path: "game.dat",
            size: 3,
            md5: null,
            url: "https://example.invalid/game.dat",
          },
        ],
        {
          fetcher: async () => new Response("new"),
          beforeCommit: async () => {
            throw new Error("game running");
          },
        },
      ),
    ).rejects.toThrow("game running");
    expect(await readFile(join(root, "game.dat"), "utf8")).toBe("old");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("another process cannot recover an active transaction", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-audit-lock-"));
  const transaction = await ResourceTransaction.begin(root);
  try {
    await writeFile(join(transaction.staging, "active"), "keep");
    const child = Bun.spawn([process.execPath, "--eval", `import { recoverResourceTransactions } from ${JSON.stringify(new URL("../src/game/resource-transaction.ts", import.meta.url).href)}; try { await recoverResourceTransactions(process.argv[1]); process.exit(1); } catch { process.exit(0); }`, root], { stdout: "ignore", stderr: "pipe" });
    expect(await child.exited).toBe(0);
    expect(await readFile(join(transaction.staging, "active"), "utf8")).toBe("keep");
  } finally {
    await transaction.finish();
    await rm(root, { recursive: true, force: true });
  }
});

test("interrupted app update recovery is repeatable without the main executable", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-audit-recover-"));
  try {
    const workspace = join(root, ".wwt-app-update-test");
    await mkdir(join(workspace, "backup"), { recursive: true });
    await writeFile(join(workspace, "backup", "WWT.exe"), "original");
    await writeFile(
      join(workspace, "journal.json"),
      JSON.stringify({
        phase: "installing",
        entries: [{ path: "WWT.exe", hadOriginal: true }],
      }),
    );
    const plan = join(workspace, "plan.json");
    await writeFile(plan, JSON.stringify({ root }));
    const script = `. ([ScriptBlock]::Create([IO.File]::ReadAllText($env:WWT_TEST_HELPER))); $plan = Get-Content -LiteralPath $env:WWT_TEST_PLAN -Raw | ConvertFrom-Json; Restore-AppPackage $plan ([IO.Path]::GetDirectoryName($env:WWT_TEST_PLAN)); Restore-AppPackage $plan ([IO.Path]::GetDirectoryName($env:WWT_TEST_PLAN))`;
    const child = Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
      env: {
        ...process.env,
        WWT_TEST_HELPER: join(import.meta.dir, "../src/platform/app-update-helper.ps1"),
        WWT_TEST_PLAN: plan,
      },
      stdout: "ignore",
      stderr: "pipe",
      windowsHide: true,
    });
    const diagnostics = await new Response(child.stderr).text();
    expect(await child.exited, diagnostics).toBe(0);
    expect(await readFile(join(root, "WWT.exe"), "utf8")).toBe("original");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
