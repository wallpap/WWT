import { describe, expect, test } from "bun:test";
import { mergeGameTimeRecords } from "../../src/game-time/log-import.ts";
import type { GameTimeRecord } from "../../src/game-time/model.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function isolatedStore(script: string): Promise<unknown> {
  const directory = await mkdtemp(join(tmpdir(), "wwt-game-time-test-"));
  try {
    const child = Bun.spawn(
      [
        process.execPath,
        "--eval",
        `
      import { mkdir, readFile, writeFile } from "node:fs/promises";
      import { join } from "node:path";
      const directory = process.argv[1];
      const { appPaths } = await import(${JSON.stringify(new URL("../../src/platform/app-paths.ts", import.meta.url).href)});
      appPaths.gameTimeRecords = join(directory, "game-time.json");
      const store = await import(${JSON.stringify(new URL("../../src/game-time/store.ts", import.meta.url).href)});
      const { importGameTimeLogs } = await import(${JSON.stringify(new URL("../../src/game-time/log-import.ts", import.meta.url).href)});
      const executable = join(directory, "Game.exe");
      const logs = join(directory, "Client", "Saved", "Logs");
      await mkdir(logs, { recursive: true });
      await writeFile(executable, "");
      const log = (start, end) => [
        "[2026.10.19-" + start + ":000] SetUserId [playerId: 1001]",
        "[2026.10.19-" + end + ":000] heartbeat",
      ].join("\\n");
      ${script}
    `,
        directory,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (exitCode !== 0) throw new Error(stderr);
    return JSON.parse(stdout) as unknown;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const record = (startTime: number, id?: number): GameTimeRecord => ({
  ...(id === undefined ? {} : { id }),
  roleId: "1001",
  gameDate: "2026-10-19",
  startTime,
  endTime: startTime + 60_000,
  duration: 60_000,
});

describe("mergeGameTimeRecords", () => {
  test("deduplicates log imports and allocates ids after the highest existing id", () => {
    const result = mergeGameTimeRecords([record(0, 4), record(120_000, 9)], [record(0), record(60_000)]);
    expect(result.addedCount).toBe(1);
    expect(result.records.map((item) => item.id)).toEqual([4, 9, 10]);
  });

  test("extends a known log session without duplicating it or shrinking it on older scans", () => {
    const existing = { ...record(0, 4), source: "log" as const };
    const extended = { ...record(0), endTime: 120_000, duration: 120_000 };
    const result = mergeGameTimeRecords([existing], [extended]);
    expect(result.addedCount).toBe(0);
    expect(result.updatedCount).toBe(1);
    expect(result.records).toEqual([{ ...existing, endTime: 120_000, duration: 120_000 }]);
    const older = mergeGameTimeRecords(result.records, [record(0)]);
    expect(older.records).toEqual(result.records);
    expect(older.updatedCount).toBe(0);
    expect(existing.duration).toBe(60_000);
  });

  test("keeps manual and unmarked historical records when a matching log session grows", () => {
    const manual = record(0, 4);
    const extended = { ...record(0), endTime: 120_000, duration: 120_000 };
    const result = mergeGameTimeRecords([manual], [extended]);
    expect(result.records[0]).toEqual(manual);
    expect(result.records[1]).toMatchObject({
      ...extended,
      id: 5,
      source: "log",
    });
    expect(mergeGameTimeRecords(result.records, [{ ...extended, endTime: 180_000, duration: 180_000 }]).records).toEqual([
      manual,
      {
        ...extended,
        endTime: 180_000,
        duration: 180_000,
        id: 5,
        source: "log",
      },
    ]);
  });
});

describe("isolated game-time store", () => {
  test("legacy imports share the write queue and remain deduplicated across restarts", async () => {
    const result = await isolatedStore(`
      const { importGameTimeRecords } = await import(${JSON.stringify(new URL("../../src/game-time/import.ts", import.meta.url).href)});
      const incoming = { roleId: "legacy", gameDate: "2026-10-19", startTime: 0, endTime: 60000, duration: 60000 };
      await Promise.all([
        store.addGameTimeRecord({ ...incoming, roleId: "manual" }),
        importGameTimeRecords([incoming]), importGameTimeRecords([incoming]),
      ]);
      const repeated = await importGameTimeRecords([incoming]);
      console.log(JSON.stringify({ roles: (await store.readGameTimeRecords()).map(row => row.roleId).sort(), added: repeated.addedCount, duplicates: repeated.duplicateCount }));
    `);
    expect(result).toEqual({
      roles: ["legacy", "manual"],
      added: 0,
      duplicates: 1,
    });
  });

  test("parses log files independently and persists a growing session on rescan", async () => {
    const result = await isolatedStore(`
      await writeFile(join(logs, "Client-old.log"), log("10.00.00", "10.10.00"));
      await writeFile(join(logs, "Client.log"), log("12.00.00", "12.10.00"));
      const first = await importGameTimeLogs(executable);
      await writeFile(join(logs, "Client-old.log"), log("10.00.00", "10.20.00"));
      const second = await importGameTimeLogs(executable);
      const saved = JSON.parse(await readFile(appPaths.gameTimeRecords, "utf8"));
      console.log(JSON.stringify({
        firstMinutes: first.records.reduce((total, record) => total + record.duration, 0) / 60000,
        secondMinutes: second.records.reduce((total, record) => total + record.duration, 0) / 60000,
        savedMinutes: saved.reduce((total, record) => total + record.duration, 0) / 60000,
        added: second.addedCount, updated: second.updatedCount,
        sameIds: first.records.map(record => record.id).sort().join() === second.records.map(record => record.id).sort().join(),
      }));
    `);
    expect(result).toEqual({
      firstMinutes: 20,
      secondMinutes: 30,
      savedMinutes: 30,
      added: 0,
      updated: 1,
      sameIds: true,
    });
  });

  test("serializes concurrent manual additions, deletion and log scanning", async () => {
    const result = await isolatedStore(`
      const manual = { roleId: "seed", gameDate: "2026-10-19", startTime: 0, endTime: 60000, duration: 60000 };
      await store.addGameTimeRecord(manual);
      await writeFile(join(logs, "Client.log"), log("10.00.00", "10.10.00"));
      await Promise.all([
        store.addGameTimeRecord({ ...manual, roleId: "A" }),
        store.deleteGameTimeRecord(1),
        importGameTimeLogs(executable),
        store.addGameTimeRecords([{ ...manual, roleId: "B" }]),
      ]);
      const records = await store.readGameTimeRecords();
      console.log(JSON.stringify({ roles: records.map(record => record.roleId).sort(), uniqueIds: new Set(records.map(record => record.id)).size }));
    `);
    expect(result).toEqual({ roles: ["1001", "A", "B"], uniqueIds: 3 });
  });

  test("continues processing store updates after a rejected write", async () => {
    const result = await isolatedStore(`
      const manual = { roleId: "A", gameDate: "2026-10-19", startTime: 0, endTime: 60000, duration: 60000 };
      let rejected = false;
      try { await store.addGameTimeRecord({ ...manual, duration: -1 }); } catch { rejected = true; }
      await store.addGameTimeRecord(manual);
      console.log(JSON.stringify({ rejected, roles: (await store.readGameTimeRecords()).map(record => record.roleId) }));
    `);
    expect(result).toEqual({ rejected: true, roles: ["A"] });
  });
});
