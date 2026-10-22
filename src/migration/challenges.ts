import type { Database } from "bun:sqlite";
import { parseNewTower, parseSlash, type TowerView } from "../kujiequ/challenge.ts";
import type { LegacyChallenge } from "../kujiequ/challenge-history.ts";
import { unixTimestampMillisecondsThreshold } from "../units.ts";

const maximumLegacyAreaStarsPerFloor = 3;

function integer(value: unknown): number {
  const result = typeof value === "bigint" ? Number(value) : value;
  if (typeof result !== "number" || !Number.isSafeInteger(result)) throw new Error("旧版挑战历史包含无效整数");
  return result;
}
function identity(row: Record<string, unknown>, deadline: string): { roleId: string; endTime: number } {
  const roleId = row["role_id"];
  const endTime = integer(row[deadline]);
  if (typeof roleId !== "string" || !/^\d+$/.test(roleId) || endTime < unixTimestampMillisecondsThreshold || !Number.isFinite(new Date(endTime).getTime())) throw new Error("旧版挑战历史的玩家或周期无效");
  return { roleId, endTime };
}

export function readJavaChallenges(db: Database, tables: Set<string>): LegacyChallenge[] {
  const result: LegacyChallenge[] = [];
  if (tables.has("game_tower")) {
    const groups = new Map<
      string,
      {
        roleId: string;
        endTime: number;
        areas: Map<number, TowerView["areas"][number]>;
      }
    >();
    for (const row of db.query<Record<string, unknown>, []>("SELECT role_id, floor, role_list, star, area_id, area_name, endTime FROM game_tower ORDER BY endTime, area_id, floor").all()) {
      const { roleId, endTime } = identity(row, "endTime");
      const key = JSON.stringify([roleId, endTime]);
      let group = groups.get(key);
      if (!group) {
        group = { roleId, endTime, areas: new Map() };
        groups.set(key, group);
      }
      const areaId = integer(row["area_id"]);
      const stars = integer(row["star"]);
      const floor = integer(row["floor"]);
      if (stars < 0 || stars > maximumLegacyAreaStarsPerFloor || floor <= 0 || typeof row["area_name"] !== "string" || (row["role_list"] !== null && typeof row["role_list"] !== "string")) throw new Error("旧版深塔楼层记录无效");
      let area = group.areas.get(areaId);
      if (!area) {
        area = { name: row["area_name"], stars: 0, maxStars: 0, floors: [] };
        group.areas.set(areaId, area);
      }
      area.stars += stars;
      area.maxStars += maximumLegacyAreaStarsPerFloor;
      const roles =
        typeof row["role_list"] === "string"
          ? row["role_list"]
              .split(",")
              .map((id) => id.trim())
              .filter(Boolean)
              .map((id) => ({ id, name: id, iconUrl: "", skillBranch: null }))
          : [];
      area.floors.push({
        floor: String(floor),
        stars,
        roleCount: roles.length,
        roles,
      });
    }
    for (const group of groups.values())
      result.push({
        roleId: group.roleId,
        snapshot: {
          id: `tower:${group.endTime}`,
          kind: "tower",
          endTime: group.endTime,
          updatedAt: 0,
          data: {
            unlocked: true,
            seasonEndTime: group.endTime,
            areas: [...group.areas.values()],
          },
        },
      });
  }
  for (const table of ["game_slash", "game_new_tower"] as const) {
    if (!tables.has(table)) continue;
    for (const row of db.query<Record<string, unknown>, []>(`SELECT role_id, end_time, data FROM ${table} ORDER BY end_time, id`).all()) {
      const { roleId, endTime } = identity(row, "end_time");
      let data: unknown;
      try {
        data = JSON.parse(String(row["data"])) as unknown;
      } catch {
        throw new Error("旧版挑战历史 JSON 无效");
      }
      if (!Array.isArray(data)) throw new Error("旧版挑战历史应为周期记录列表");
      // 原版数据库已保存绝对截止时间，直接保留，避免再叠加当前时间。
      const base = { endTime, updatedAt: 0 };
      if (table === "game_slash")
        result.push({
          roleId,
          snapshot: {
            ...base,
            id: `slash:${endTime}`,
            kind: "slash",
            data: parseSlash({
              isUnlock: true,
              seasonEndTime: endTime,
              difficultyList: data,
            }),
          },
        });
      else
        result.push({
          roleId,
          snapshot: {
            ...base,
            id: `new-tower:${endTime}`,
            kind: "new-tower",
            data: parseNewTower({ isUnlock: true, endTime, modeDetails: data }),
          },
        });
    }
  }
  return result;
}
