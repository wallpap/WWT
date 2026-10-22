import type { GachaRecord } from "./model.ts";
import { defaultGachaRecordCount, minimumGachaQualityLevel, minimumGachaRecordCount, minimumResourceId } from "./constants.ts";

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;
}

function requiredString(value: unknown, label: string, index: number): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`第 ${index + 1} 条记录缺少${label}`);
  }
  return value.trim();
}

function requiredInteger(value: unknown, label: string, index: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`第 ${index + 1} 条记录的${label}无效`);
  }
  return value;
}

function normalizeTime(value: unknown, index: number): string {
  if (typeof value === "string" && value.trim() !== "") {
    if (Number.isNaN(Date.parse(value))) {
      throw new Error(`第 ${index + 1} 条记录的时间无法识别`);
    }
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  throw new Error(`第 ${index + 1} 条记录缺少有效时间`);
}

function normalizeRecord(value: unknown, index: number, defaults: { playerId?: string; gachaName?: string } = {}): GachaRecord {
  const source = objectValue(value);
  if (!source) throw new Error(`第 ${index + 1} 条记录格式无效`);

  const playerId = source["playerId"] ?? defaults.playerId;
  const gachaName = source["gachaName"] ?? defaults.gachaName;
  const count = source["count"] ?? defaultGachaRecordCount;

  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < minimumGachaRecordCount) {
    throw new Error(`第 ${index + 1} 条记录的抽数无效`);
  }

  const record: GachaRecord = {
    playerId: requiredString(playerId, "玩家 ID", index),
    gachaName: requiredString(gachaName, "卡池名称", index),
    cardPoolType: requiredString(source["cardPoolType"], "卡池类型", index),
    resourceId: requiredInteger(source["resourceId"], "资源 ID", index),
    qualityLevel: requiredInteger(source["qualityLevel"], "品质", index),
    resourceType: requiredString(source["resourceType"], "资源类型", index),
    name: requiredString(source["name"], "名称", index),
    count,
    time: normalizeTime(source["time"], index),
  };

  if (record.resourceId < minimumResourceId || record.qualityLevel < minimumGachaQualityLevel) {
    throw new Error(`第 ${index + 1} 条记录的资源 ID 或品质无效`);
  }
  return record;
}

export function parseGachaImport(json: string, fallbackPlayerId?: string): GachaRecord[] {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    throw new Error("文件不是有效的 JSON");
  }

  if (Array.isArray(value)) {
    if (value.length === 0) throw new Error("文件中没有抽卡记录");
    return value.map((record, index) =>
      normalizeRecord(record, index, {
        ...(fallbackPlayerId ? { playerId: fallbackPlayerId } : {}),
      }),
    );
  }

  const playerId = fallbackPlayerId?.trim();
  const pools = objectValue(value);
  if (!pools || !playerId) {
    throw new Error("旧版 pool.json 需要同时填写玩家 ID");
  }

  const records: GachaRecord[] = [];
  for (const [gachaName, poolRecords] of Object.entries(pools)) {
    if (!Array.isArray(poolRecords)) throw new Error(`卡池“${gachaName}”的数据格式无效`);
    for (const record of poolRecords) {
      records.push(normalizeRecord(record, records.length, { playerId, gachaName }));
    }
  }
  if (records.length === 0) throw new Error("文件中没有抽卡记录");
  return records;
}
