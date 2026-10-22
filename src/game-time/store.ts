import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { appPaths } from "../platform/app-paths.ts";
import type { GameTimeRecord } from "./model.ts";

const storePath = appPaths.gameTimeRecords;
let pendingUpdate: Promise<void> = Promise.resolve();

function serializeUpdate<Result>(operation: () => Promise<Result>): Promise<Result> {
  const result = pendingUpdate.then(operation);
  pendingUpdate = result.then(
    () => {},
    () => {},
  );
  return result;
}

function isGameTimeRecord(value: unknown): value is GameTimeRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (record["id"] === undefined || (typeof record["id"] === "number" && Number.isSafeInteger(record["id"]))) && (record["source"] === undefined || record["source"] === "log" || record["source"] === "auto") && (record["roleId"] === null || typeof record["roleId"] === "string") && typeof record["gameDate"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record["gameDate"]) && typeof record["startTime"] === "number" && Number.isSafeInteger(record["startTime"]) && typeof record["endTime"] === "number" && Number.isSafeInteger(record["endTime"]) && typeof record["duration"] === "number" && Number.isSafeInteger(record["duration"]) && record["duration"] >= 0 && record["endTime"] >= record["startTime"] && record["duration"] === record["endTime"] - record["startTime"];
}

export async function readGameTimeRecords(): Promise<GameTimeRecord[]> {
  try {
    const contents = await readFile(storePath, "utf8");
    const value: unknown = JSON.parse(contents);
    if (!Array.isArray(value) || !value.every(isGameTimeRecord)) {
      throw new Error("本地游戏时长数据格式无效");
    }
    return value;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function persistGameTimeRecords(records: readonly GameTimeRecord[]): Promise<void> {
  if (!records.every(isGameTimeRecord)) throw new Error("游戏时长记录格式无效");
  await mkdir(dirname(storePath), { recursive: true });
  const temporaryPath = `${storePath}.${randomUUID()}.tmp`;
  try {
    await Bun.write(temporaryPath, `${JSON.stringify(records, null, 2)}\n`);
    await rename(temporaryPath, storePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export function writeGameTimeRecords(records: readonly GameTimeRecord[]): Promise<void> {
  return serializeUpdate(() => persistGameTimeRecords(records));
}

export function updateGameTimeRecords<Result>(
  update: (records: GameTimeRecord[]) => {
    records: GameTimeRecord[];
    result: Result;
  },
): Promise<Result> {
  return serializeUpdate(async () => {
    // 读取也进入队列，使合并基于上一次写回的结果。
    const records = await readGameTimeRecords();
    const next = update(records);
    if (next.records !== records) await persistGameTimeRecords(next.records);
    return next.result;
  });
}

export async function addGameTimeRecord(record: Omit<GameTimeRecord, "id">): Promise<GameTimeRecord[]> {
  return addGameTimeRecords([record]);
}

export async function addGameTimeRecords(recordsToAdd: readonly Omit<GameTimeRecord, "id">[]): Promise<GameTimeRecord[]> {
  return updateGameTimeRecords((records) => {
    let nextId = records.reduce((max, item) => Math.max(max, item.id ?? 0), 0) + 1;
    const next = [...records, ...recordsToAdd.map((record) => ({ ...record, id: nextId++ }))];
    return { records: next, result: next };
  });
}

export async function deleteGameTimeRecord(id: number): Promise<GameTimeRecord[]> {
  return updateGameTimeRecords((records) => {
    const next = records.filter((record) => record.id !== id);
    return {
      records: next.length === records.length ? records : next,
      result: next,
    };
  });
}
