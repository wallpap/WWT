import { createHash } from "node:crypto";
import { timestampFromLine } from "../game-time/log-parser.ts";
import { battleFields, validDate, type BattleCounters, type BattleRecord } from "./model.ts";

export interface BattleLogEvent {
  id: string;
  roleId: string;
  date: string;
  kind: keyof BattleCounters | "monthCard";
  value: number;
  time: number;
}
const keywords: Partial<Record<keyof BattleCounters, string>> = {
  roleChange: "角色下场，立即隐藏",
  roleDeath: "前台角色死亡进行切人",
  battle: "切换玩家状态: 进入战斗造成伤害",
  phantomGet: "[技能名称: 初次幻象收服]",
  phantomCallSkill: "召唤系幻象的出生特效",
  phantomTransformSkill: "结束技能名称: 变身幻象",
  paralysis: "进入倒地状态",
  transfer: "传送:完成",
};
export function parseBattleLogLines(lines: Iterable<string>, initialRoleId: string | null = null): { events: BattleLogEvent[]; roleId: string | null } {
  const events: BattleLogEvent[] = [];
  let roleId = initialRoleId;
  let strength: number | null = null;
  const occurrences = new Map<string, number>();
  for (const line of lines) {
    const time = timestampFromLine(line);
    if (time === null) continue;
    const login = /SetUserId\s+\[playerId:\s*(\d+)/.exec(line)?.[1];
    if (login !== undefined) {
      if (roleId !== login) strength = null;
      roleId = login;
      continue;
    }
    if (roleId === null) continue;
    const date = new Date(time);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    function add(kind: BattleLogEvent["kind"], value = 1): void {
      const identity = JSON.stringify([roleId, time, kind, value]);
      const ordinal = occurrences.get(identity) ?? 0;
      occurrences.set(identity, ordinal + 1);
      const id = createHash("sha256").update(`${identity}:${ordinal}`).digest("hex");
      events.push({ id, roleId: roleId!, date: day, kind, value, time: time! });
    }
    for (const [kind, keyword] of Object.entries(keywords)) if (line.includes(keyword)) add(kind as keyof BattleCounters);
    if (/结束技能名称: .*极限闪避前闪/.test(line)) add("parryFront");
    else if (/结束技能名称: .*极限闪避后闪/.test(line)) add("parryBack");
    if (/结束技能名称: .*极限闪避反击/.test(line)) add("parryAttack");
    if (line.includes("当前体力数据 [data: ")) {
      const matches = [...line.matchAll(/UPs:(\d+)/g)];
      if (matches.length) {
        const next = matches.reduce((sum, match) => sum + Number(match[1]), 0);
        if (strength !== null && next < strength) add("usedStrength", strength - next);
        strength = next;
      }
    }
    if (line.includes("【月卡每日奖励】信息推送")) add("monthCard", Number(/remainDays:\s*(\d+)/.exec(line)?.[1] ?? 0));
  }
  return { events, roleId };
}

export function parseBattleLogEvents(value: unknown): BattleLogEvent[] {
  if (!Array.isArray(value)) throw new Error("战斗日志索引无效");
  return value.map((item) => {
    if (typeof item !== "object" || item === null) throw new Error("战斗日志索引条目无效");
    const row = item as Record<string, unknown>;
    if (typeof row["id"] !== "string" || !/^[a-f\d]{64}$/.test(row["id"]) || typeof row["roleId"] !== "string" || !/^\d+$/.test(row["roleId"]) || typeof row["date"] !== "string" || !validDate(row["date"]) || typeof row["kind"] !== "string" || !(Object.hasOwn(battleFields, row["kind"]) || row["kind"] === "monthCard") || typeof row["value"] !== "number" || !Number.isSafeInteger(row["value"]) || row["value"] < 0 || typeof row["time"] !== "number" || !Number.isSafeInteger(row["time"]) || !Number.isFinite(new Date(row["time"]).getTime())) throw new Error("战斗日志索引条目无效");
    return {
      id: row["id"],
      roleId: row["roleId"],
      date: row["date"],
      kind: row["kind"] as BattleLogEvent["kind"],
      value: row["value"],
      time: row["time"],
    };
  });
}

export function summarizeBattleEvents(events: readonly BattleLogEvent[]): BattleRecord[] {
  const rows = new Map<string, BattleRecord>();
  const seen = new Set<string>();
  for (const event of [...events].sort((a, b) => a.time - b.time)) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    const key = JSON.stringify([event.roleId, event.date]);
    let row = rows.get(key);
    if (!row) {
      row = {
        ...(Object.fromEntries(Object.keys(battleFields).map((key) => [key, 0])) as BattleCounters),
        roleId: event.roleId,
        date: event.date,
        monthCard: false,
        monthCardRemainDays: 0,
      };
      rows.set(key, row);
    }
    if (event.kind === "monthCard") {
      row.monthCard = true;
      row.monthCardRemainDays = event.value;
    } else row[event.kind] += event.value;
  }
  return [...rows.values()];
}

export function combineBattleObservations(legacy: readonly BattleRecord[], observed: readonly BattleRecord[]): BattleRecord[] {
  const rows = new Map(legacy.map((row) => [JSON.stringify([row.roleId, row.date]), { ...row }]));
  for (const row of observed) {
    const key = JSON.stringify([row.roleId, row.date]);
    const previous = rows.get(key);
    if (!previous) {
      rows.set(key, { ...row });
      continue;
    }
    // 原版日报可能已包含相同日志，各指标取较大值保留已有统计并避免重复累加。
    for (const kind of Object.keys(battleFields) as (keyof BattleCounters)[]) previous[kind] = Math.max(previous[kind], row[kind]);
    if (row.monthCard) {
      previous.monthCard = true;
      previous.monthCardRemainDays = row.monthCardRemainDays;
    }
  }
  return [...rows.values()].sort((a, b) => b.date.localeCompare(a.date));
}
