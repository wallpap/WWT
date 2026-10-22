import type { Database } from "bun:sqlite";
import { battleFields, parseArchive, type LocalArchive } from "../local-data/model.ts";

function integer(value: unknown): number {
  const result = typeof value === "bigint" ? Number(value) : (value ?? 0);
  if (typeof result !== "number" || !Number.isSafeInteger(result)) throw new Error("原版本地档案整数无效");
  return result;
}
function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "bigint" ? String(value) : "";
}
const snake = (key: string): string => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
export function readJavaLocalData(db: Database, tables: Set<string>): LocalArchive {
  const battles = tables.has("game_record")
    ? db
        .query<Record<string, unknown>, []>(`SELECT role_id, create_date, ${Object.keys(battleFields).map(snake).join(", ")}, month_card, month_card_remain_days FROM game_record ORDER BY create_date, id`)
        .all()
        .map((row) => ({
          ...Object.fromEntries(Object.keys(battleFields).map((key) => [key, integer(row[snake(key)])])),
          roleId: row["role_id"] === null || row["role_id"] === "" ? null : text(row["role_id"]),
          date: text(row["create_date"]),
          monthCard: integer(row["month_card"]) === 1,
          monthCardRemainDays: integer(row["month_card_remain_days"]),
        }))
    : [];
  // 本地玩家表另含登录凭据，迁移字段明确限定为展示资料。
  const players = tables.has("local_cache_player_data")
    ? db
        .query<Record<string, unknown>, []>("SELECT role_id, role_name, level, sex, head_photo, region, update_time FROM local_cache_player_data ORDER BY update_time, id")
        .all()
        .map((row) => ({
          roleId: text(row["role_id"]),
          name: text(row["role_name"]),
          level: integer(row["level"]),
          sex: integer(row["sex"]),
          headPhoto: text(row["head_photo"]),
          region: text(row["region"]),
          updatedAt: integer(row["update_time"]),
        }))
    : [];
  const roles = tables.has("game_role")
    ? db
        .query<Record<string, unknown>, []>("SELECT role_id, role_name, role_icon_url, role_pic_url, star_level, attribute_id, attribute_name, weapon_type_id, weapon_type_name, acronym, breach FROM game_role ORDER BY role_id")
        .all()
        .map((row) => ({
          roleId: text(row["role_id"]),
          name: text(row["role_name"]),
          iconUrl: text(row["role_icon_url"]),
          pictureUrl: text(row["role_pic_url"]),
          starLevel: integer(row["star_level"]),
          attributeId: integer(row["attribute_id"]),
          attributeName: text(row["attribute_name"]),
          weaponTypeId: integer(row["weapon_type_id"]),
          weaponTypeName: text(row["weapon_type_name"]),
          acronym: text(row["acronym"]),
          breach: integer(row["breach"]),
        }))
    : [];
  return parseArchive({ battles, players, roles });
}
