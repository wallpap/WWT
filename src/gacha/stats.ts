import type { GachaRecord, GachaSummary } from "./model.ts";
import { gachaPool } from "./pools.ts";
import { astritePerPull, fiveStarQualityLevel, fourStarQualityLevel } from "./constants.ts";
import { percentageScale } from "../units.ts";

const residentFiveStarIds = new Set([1104, 1203, 1301, 1503, 1405, 21010015, 21020015, 21030015, 21040015, 21050015, 21050045, 21030045, 21010045, 21020045, 21040045]);
export function summarizeGacha(records: readonly GachaRecord[]): GachaSummary {
  const counts = new Map<string, number>();
  let totalPulls = 0;
  let ssrCount = 0;
  let upSsrCount = 0;
  let srCount = 0;
  let rCount = 0;
  let startTime: string | null = null;
  let endTime: string | null = null;
  let rolePulls = 0;
  let roleSsr = 0;
  let weaponPulls = 0;
  let weaponSsr = 0;
  const upCounts = new Map<string, number>();
  const roleBannerFiveStars = new Map<string, GachaRecord[]>();

  for (const record of records) {
    totalPulls += record.count;
    if (startTime === null || Date.parse(record.time) < Date.parse(startTime)) startTime = record.time;
    if (endTime === null || Date.parse(record.time) > Date.parse(endTime)) endTime = record.time;
    const pool = gachaPool(record);
    const isRole = pool.kind === "role";
    const isWeapon = pool.kind === "weapon";
    if (isRole) rolePulls += record.count;
    else if (isWeapon) weaponPulls += record.count;

    if (record.qualityLevel >= fiveStarQualityLevel) {
      ssrCount += 1;
      if (!residentFiveStarIds.has(record.resourceId)) {
        upSsrCount += 1;
        upCounts.set(record.name, (upCounts.get(record.name) ?? 0) + 1);
      }
      if (isRole) roleSsr += 1;
      else if (isWeapon) weaponSsr += 1;
      counts.set(record.name, (counts.get(record.name) ?? 0) + 1);
      if (pool.roleBanner) {
        const key = JSON.stringify([record.playerId, pool.key]);
        const bannerRecords = roleBannerFiveStars.get(key) ?? [];
        bannerRecords.push(record);
        roleBannerFiveStars.set(key, bannerRecords);
      }
    } else if (record.qualityLevel === fourStarQualityLevel) {
      srCount += 1;
    } else {
      rCount += 1;
    }
  }

  const topSsr = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
  let fiftyFiftyCount = 0;
  let fiftyFiftyWins = 0;
  for (const bannerRecords of roleBannerFiveStars.values()) {
    let guaranteed = false;
    for (const record of bannerRecords.sort((left, right) => Date.parse(left.time) - Date.parse(right.time))) {
      const isUp = !residentFiveStarIds.has(record.resourceId);
      if (guaranteed) {
        guaranteed = false;
      } else {
        fiftyFiftyCount += 1;
        if (isUp) fiftyFiftyWins += 1;
        else guaranteed = true;
      }
    }
  }
  return {
    totalPulls,
    totalStones: totalPulls * astritePerPull,
    ssrCount,
    upSsrCount,
    nonBannerRate: fiftyFiftyCount === 0 ? 0 : (fiftyFiftyWins / fiftyFiftyCount) * percentageScale,
    srCount,
    rCount,
    averagePullsPerSsr: ssrCount === 0 ? 0 : totalPulls / ssrCount,
    startTime,
    endTime,
    topSsr,
    rolePulls,
    roleSsr,
    roleAveragePullsPerSsr: roleSsr === 0 ? 0 : rolePulls / roleSsr,
    weaponPulls,
    weaponSsr,
    weaponAveragePullsPerSsr: weaponSsr === 0 ? 0 : weaponPulls / weaponSsr,
    topUpSsr: [...upCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null,
  };
}
