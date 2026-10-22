import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseBattleLogLines, summarizeBattleEvents } from "../../src/local-data/battle-log.ts";
import { importBattleLogs } from "../../src/local-data/battle-log-import.ts";
import { LocalArchiveStore } from "../../src/local-data/store.ts";
import { decodeGameLog } from "../../src/game/log-text.ts";
import { emptyArchive } from "../../src/local-data/model.ts";

const line = (date: string, message: string) => `[${date}] ${message}`;
const rows = [line("2026.10.19-23.59.50:000", "SetUserId [playerId: 123]"), line("2026.10.19-23.59.51:000", "角色下场，立即隐藏"), line("2026.10.19-23.59.52:000", "当前体力数据 [data: UPs:60]"), line("2026.10.19-23.59.53:000", "当前体力数据 [data: UPs:0]"), line("2026.10.19-23.59.54:000", "切换玩家状态: 进入战斗造成伤害 token=must-not-persist"), line("2026.10.19-23.59.55:000", "结束技能名称: 角色极限闪避前闪"), line("2026.10.19-23.59.55:000", "结束技能名称: 角色极限闪避前闪"), line("2026.10.20-00.00.01:000", "【月卡每日奖励】信息推送 remainDays: 10"), line("2026.10.20-00.00.02:000", "SetUserId [playerId: 456]"), line("2026.10.20-00.00.03:000", "当前体力数据 [data: UPs:20]"), line("2026.10.20-00.00.04:000", "当前体力数据 [data: UPs:0]"), line("2026.10.20-00.00.05:000", "前台角色死亡进行切人"), line("2026.99.20-00.00.05:000", "前台角色死亡进行切人")];
function encrypted(text: string): Uint8Array {
  return Uint8Array.from(new TextEncoder().encode(text), (value) => ((value & 1) === 0 ? value ^ 0xa5 : value ^ 0xef));
}

test("battle events retain player and day boundaries, zero stamina consumption and distinct simultaneous events", () => {
  const events = parseBattleLogLines(rows).events;
  expect(events.filter((event) => event.kind === "parryFront")).toHaveLength(2);
  const summaries = summarizeBattleEvents([...events, ...events]);
  expect(summaries).toHaveLength(3);
  expect(summaries.find((row) => row.roleId === "123" && row.date === "2026-10-19")).toMatchObject({
    usedStrength: 60,
    roleChange: 1,
    battle: 1,
    parryFront: 2,
  });
  expect(summaries.find((row) => row.roleId === "123" && row.date === "2026-10-20")).toMatchObject({
    monthCard: true,
    monthCardRemainDays: 10,
    usedStrength: 0,
  });
  expect(summaries.find((row) => row.roleId === "456")).toMatchObject({
    usedStrength: 20,
    roleDeath: 1,
  });
  expect(parseBattleLogLines([line("2026.10.20-00.00.05:000", "前台角色死亡进行切人")]).events).toEqual([]);
  expect(decodeGameLog(encrypted(rows.join("\n")))).toBe(rows.join("\n"));
  expect(decodeGameLog(new TextEncoder().encode(rows.join("\n")))).toBe(rows.join("\n"));
});

test("encrypted and overlapping backup logs import once, growing logs append events and legacy daily observations remain intact", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-battle-log-"));
  try {
    const logs = join(root, "Client/Saved/Logs");
    await mkdir(logs, { recursive: true });
    const file = join(logs, "Client.log");
    const storePath = join(root, "archive.json");
    const store = new LocalArchiveStore(storePath);
    await writeFile(file, encrypted(rows.join("\n")));
    await writeFile(join(logs, "Client-backup.log"), rows.join("\n"));
    const executable = join(root, "Game.exe");
    await writeFile(executable, "fixture");
    const first = await importBattleLogs(executable, store);
    expect(first.scannedFiles).toBe(2);
    expect(first.addedCount).toBe(parseBattleLogLines(rows).events.length);
    expect((await importBattleLogs(executable, new LocalArchiveStore(storePath))).addedCount).toBe(0);
    await writeFile(file, encrypted([...rows, line("2026.10.20-00.00.10:000", "传送:完成")].join("\n")));
    expect((await importBattleLogs(executable, store)).addedCount).toBe(1);
    const current = await store.read();
    expect(current.battles.find((row) => row.roleId === "456")!.transfer).toBe(1);
    const previous = {
      ...current.battles.find((row) => row.roleId === "123" && row.date === "2026-10-19")!,
      battle: 5,
    };
    await store.importLegacy({ ...emptyArchive(), battles: [previous] });
    const reopened = await new LocalArchiveStore(storePath).read();
    expect(reopened.battles.find((row) => row.roleId === "123" && row.date === "2026-10-19")!.battle).toBe(5);
    expect(reopened.battles.find((row) => row.roleId === "456")!.transfer).toBe(1);
    expect(await readFile(storePath, "utf8")).not.toContain("must-not-persist");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
