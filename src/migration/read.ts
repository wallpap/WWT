import { Database } from "bun:sqlite";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseGachaImport } from "../gacha/import.ts";
import { parseGachaXlsx } from "../gacha/xlsx.ts";
import type { GachaRecord } from "../gacha/model.ts";
import type { GameTimeRecord } from "../game-time/model.ts";
import type { LegacyChallenge } from "../kujiequ/challenge-history.ts";
import { readJavaChallenges } from "./challenges.ts";
import { readJavaSigns } from "./signs.ts";
import type { LegacySign } from "../kujiequ/sign-store.ts";
import type { LegacyAccount } from "../kujiequ/legacy-account.ts";
import { readJavaAccounts } from "./accounts.ts";
import type { LegacySettings } from "./settings.ts";
import { readJavaLocalData } from "./local-data.ts";
import type { LocalArchive } from "../local-data/model.ts";
import { readJavaSettings } from "./java-settings.ts";

export type MigrationSource = "java-sqlite" | "xlsx" | "java-accounts" | "java-settings";
export interface MigrationRecords {
  gacha: GachaRecord[];
  gameTime: GameTimeRecord[];
  challenges?: LegacyChallenge[];
  signs?: LegacySign[];
  accounts?: LegacyAccount[];
  settings?: LegacySettings;
  archive?: LocalArchive;
}

function integer(value: unknown): number {
  const result = typeof value === "bigint" ? Number(value) : value;
  if (typeof result !== "number" || !Number.isSafeInteger(result)) throw new Error("旧版记录包含无效整数");
  return result;
}

function parseGameTime(rows: Record<string, unknown>[]): GameTimeRecord[] {
  return rows.map((row, index) => {
    const startTime = integer(row["start_time"]);
    const endTime = integer(row["end_time"]);
    const duration = integer(row["duration"]);
    const gameDate = row["game_date"];
    const roleId = row["role_id"];
    if (typeof gameDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(gameDate) || !Number.isFinite(Date.parse(`${gameDate}T00:00:00Z`)) || new Date(`${gameDate}T00:00:00Z`).toISOString().slice(0, 10) !== gameDate || (roleId !== null && (typeof roleId !== "string" || !roleId.trim())) || !Number.isFinite(new Date(startTime).getTime()) || !Number.isFinite(new Date(endTime).getTime()) || endTime < startTime || duration !== endTime - startTime) throw new Error(`第 ${index + 1} 条旧版时长记录无效`);
    return { roleId, gameDate, startTime, endTime, duration };
  });
}

export function readJavaDatabase(path: string): MigrationRecords {
  const db = new Database(path, { readonly: true, safeIntegers: true });
  try {
    db.exec("BEGIN");
    const tables = new Set(
      db
        .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('game_gacha', 'game_time', 'game_tower', 'game_slash', 'game_new_tower', 'sign_history', 'game_record', 'local_cache_player_data', 'game_role')")
        .all()
        .map((row) => row.name),
    );
    if (tables.size === 0) throw new Error("所选数据库没有支持迁移的原版业务数据表");
    // 明确列出业务字段，避免将账号表和凭据带入迁移快照。
    const gachaRows = tables.has("game_gacha")
      ? db
          .query<Record<string, unknown>, []>("SELECT player_id, gacha_name, card_pool_type, resource_id, quality_level, resource_type, name, count, time FROM game_gacha ORDER BY time, id")
          .all()
          .map((row) => ({
            playerId: row["player_id"],
            gachaName: row["gacha_name"],
            cardPoolType: row["card_pool_type"],
            resourceType: row["resource_type"],
            name: row["name"],
            resourceId: integer(row["resource_id"]),
            qualityLevel: integer(row["quality_level"]),
            count: integer(row["count"]),
            time: integer(row["time"]),
          }))
      : [];
    const timeRows = tables.has("game_time") ? db.query<Record<string, unknown>, []>("SELECT role_id, game_date, start_time, end_time, duration FROM game_time ORDER BY start_time, id").all() : [];
    return {
      gacha: gachaRows.length ? parseGachaImport(JSON.stringify(gachaRows)) : [],
      gameTime: parseGameTime(timeRows),
      challenges: readJavaChallenges(db, tables),
      signs: tables.has("sign_history") ? readJavaSigns(db) : [],
      archive: readJavaLocalData(db, tables),
    };
  } finally {
    db.close();
  }
}

export async function readMigrationSource(source: MigrationSource, inputPath: string, playerId?: string): Promise<MigrationRecords> {
  if (!inputPath.trim()) throw new Error("请选择迁移来源");
  const path = resolve(inputPath.trim());
  if (!(await stat(path)).isFile()) throw new Error("请选择有效的数据文件");
  if (source === "java-sqlite") return readJavaDatabase(path);
  if (source === "java-accounts") return { gacha: [], gameTime: [], accounts: readJavaAccounts(path) };
  if (source === "java-settings") return { gacha: [], gameTime: [], settings: await readJavaSettings(path) };
  if (source === "xlsx")
    return {
      gacha: parseGachaXlsx(await Bun.file(path).bytes(), playerId),
      gameTime: [],
    };
  throw new Error("迁移来源类型无效");
}
