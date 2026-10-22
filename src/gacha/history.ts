import type { GachaRecord } from "./model.ts";
import { gachaPool } from "./pools.ts";
import { fiveStarQualityLevel, fourStarQualityLevel } from "./constants.ts";

export interface FiveStarPull {
  resourceId: number;
  name: string;
  time: string;
  pulls: number;
  complete: boolean;
  gachaName: string;
}
export interface GachaPoolHistory {
  key: string;
  playerId: string;
  poolName: string;
  totalPulls: number;
  currentFiveStarPity: number;
  currentFourStarPity: number;
  hasFiveStar: boolean;
  completedAverage: number | null;
  fiveStars: FiveStarPull[];
}

export function buildGachaHistory(records: readonly GachaRecord[]): GachaPoolHistory[] {
  const groups = new Map<string, GachaPoolHistory>();
  // 排序比较会执行多次，提前解析时间以减少大量记录下的主线程开销。
  const chronological = records.map((record) => ({ record, timestamp: Date.parse(record.time) }));
  chronological.sort((a, b) => a.timestamp - b.timestamp);
  for (const { record } of chronological) {
    const pool = gachaPool(record);
    const key = JSON.stringify([record.playerId, pool.key]);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        playerId: record.playerId,
        poolName: pool.name,
        totalPulls: 0,
        currentFiveStarPity: 0,
        currentFourStarPity: 0,
        hasFiveStar: false,
        completedAverage: null,
        fiveStars: [],
      };
      groups.set(key, group);
    }
    group.totalPulls += record.count;
    group.currentFiveStarPity += record.count;
    group.currentFourStarPity += record.count;
    if (record.qualityLevel >= fiveStarQualityLevel) {
      group.fiveStars.push({
        resourceId: record.resourceId,
        name: record.name,
        time: record.time,
        pulls: group.currentFiveStarPity,
        complete: group.hasFiveStar,
        gachaName: record.gachaName,
      });
      group.hasFiveStar = true;
      group.currentFiveStarPity = 0;
    }
    if (record.qualityLevel >= fourStarQualityLevel) group.currentFourStarPity = 0;
  }
  for (const group of groups.values()) {
    // 首个五星之前的记录可能缺失，平均值仅使用两个五星之间的完整区间。
    const complete = group.fiveStars.filter((row) => row.complete);
    group.completedAverage = complete.length ? complete.reduce((sum, row) => sum + row.pulls, 0) / complete.length : null;
    group.fiveStars.reverse();
  }
  return [...groups.values()];
}
