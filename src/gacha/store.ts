import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { appPaths } from "../platform/app-paths.ts";
import type { GachaRecord } from "./model.ts";

const storePath = appPaths.gachaRecords;

function isGachaRecord(value: unknown): value is GachaRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record["playerId"] === "string" && typeof record["gachaName"] === "string" && typeof record["cardPoolType"] === "string" && typeof record["resourceId"] === "number" && Number.isSafeInteger(record["resourceId"]) && typeof record["qualityLevel"] === "number" && Number.isSafeInteger(record["qualityLevel"]) && typeof record["resourceType"] === "string" && typeof record["name"] === "string" && typeof record["count"] === "number" && Number.isSafeInteger(record["count"]) && typeof record["time"] === "string";
}

export async function readGachaRecords(): Promise<GachaRecord[]> {
  try {
    const contents = await readFile(storePath, "utf8");
    const value: unknown = JSON.parse(contents);
    if (!Array.isArray(value) || !value.every(isGachaRecord)) {
      throw new Error("本地抽卡数据格式无效");
    }
    return value;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

function recordKey(record: GachaRecord): string {
  const timestamp = Date.parse(record.time);
  return JSON.stringify([record.playerId, Number.isNaN(timestamp) ? record.time : timestamp, record.resourceId, record.name, record.gachaName]);
}

export function mergeGachaRecords(existing: readonly GachaRecord[], incoming: readonly GachaRecord[]): { records: GachaRecord[]; addedCount: number } {
  const records = [...existing];
  const remaining = new Map<string, number>();
  for (const record of existing) {
    const key = recordKey(record);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  let addedCount = 0;

  for (const record of incoming) {
    const key = recordKey(record);
    // 十连中可能同秒获得多个相同物品；按已有次数匹配，保留本批多出的抽数。
    const matched = remaining.get(key) ?? 0;
    if (matched > 0) {
      remaining.set(key, matched - 1);
      continue;
    }
    records.push(record);
    addedCount += 1;
  }
  records.sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
  return { records, addedCount };
}

export async function writeGachaRecords(records: readonly GachaRecord[]): Promise<void> {
  await mkdir(dirname(storePath), { recursive: true });
  const temporaryPath = `${storePath}.${randomUUID()}.tmp`;
  try {
    await Bun.write(temporaryPath, `${JSON.stringify(records, null, 2)}\n`);
    await rename(temporaryPath, storePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
