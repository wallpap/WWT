import { saveOptionalCache } from "./optional-cache.ts";
import type { AccountService } from "./accounts.ts";
import { object, text, type KuroRole, type KuroSession } from "./model.ts";
import { queryCacheStore, queryScope, type QueryCacheStore } from "./query-cache.ts";
import { millisecondsPerMinute } from "../units.ts";

export interface DailyMetric {
  name: string;
  value: string;
  icon?: string;
  iconUrl?: string;
}
export interface DailyView {
  roleId: string;
  roleName: string;
  updatedAt: number;
  metrics: DailyMetric[];
  base: DailyMetric[];
  boxes: DailyMetric[];
  cached?: boolean;
}
const dailyFields: Record<string, string> = {
  energyData: "结晶波片",
  storeEnergyData: "备用结晶波片",
  livenessData: "每日活跃",
  battlePassData: "先约电台",
  weeklyData: "周本",
  towerData: "逆境深塔",
  newTowerData: "终焉矩阵",
  slashTowerData: "冥歌海墟",
  weeklyFrameData: "周常",
  weeklyRougeData: "周常积分",
};

export function parseDaily(daily: unknown, base: unknown, role: KuroRole): DailyView {
  const data = object(daily);
  const info = object(base);
  if (text(data["roleId"]) && text(data["roleId"]) !== role.roleId) throw new Error("每日数据与所选角色不匹配");
  if (text(info["id"]) && text(info["id"]) !== role.roleId) throw new Error("基础数据与所选角色不匹配");
  const metrics: DailyMetric[] = [];
  for (const [key, fallback] of Object.entries(dailyFields)) {
    const value = data[key];
    if (value === undefined || value === null) continue;
    for (const entry of Array.isArray(value) ? value : [value]) {
      const detail = object(entry);
      const current = text(detail["cur"]);
      const total = text(detail["total"]);
      metrics.push({
        icon: key,
        name: text(detail["name"]) || fallback,
        value: text(detail["value"]) || (current ? `${current}${total ? ` / ${total}` : ""}` : "暂无数据"),
        ...(text(detail["img"]) ? { iconUrl: text(detail["img"]) } : {}),
      });
    }
  }
  const baseFields: Record<string, string> = {
    level: "联觉等级",
    worldLevel: "索拉等级",
    activeDays: "活跃天数",
    roleNum: "共鸣者数量",
    achievementCount: "成就数量",
    achievementStar: "成就星数",
    soundBox: "声匣数量",
    bigCount: "大型信标",
    smallCount: "小型信标",
  };
  const baseMetrics = Object.entries(baseFields).flatMap(([key, name]) => (text(info[key]) ? [{ name, value: text(info[key]) }] : []));
  const boxes: DailyMetric[] = [];
  for (const [key, group] of [
    ["boxList", "宝箱"],
    ["treasureBoxList", "宝藏"],
    ["phantomBoxList", "声骸"],
  ]) {
    const list = info[key!];
    if (list == null) continue;
    if (!Array.isArray(list)) throw new Error("宝箱数据格式无效");
    for (const entry of list) {
      const item = object(entry);
      boxes.push({
        name: `${group} · ${text(item["boxName"]) || text(item["location"]) || text(item["name"])}`,
        value: text(item["num"]) || "0",
      });
    }
  }
  return {
    roleId: role.roleId,
    roleName: role.roleName,
    updatedAt: Date.now(),
    metrics,
    base: baseMetrics,
    boxes,
  };
}

export class DailyService {
  #cache = new Map<string, DailyView>();
  constructor(
    private readonly accounts: AccountService,
    private readonly queries: Pick<QueryCacheStore, "read" | "save"> = queryCacheStore,
  ) {}
  async #load(session: KuroSession, role: KuroRole, force: boolean): Promise<DailyView> {
    const key = `${session.id}:${role.roleId}:${role.serverId}`;
    const cached = this.#cache.get(key);
    if (!force && cached && Date.now() - cached.updatedAt < millisecondsPerMinute) return cached;
    const daily = await this.accounts.api.roleRequest("/gamer/widget/game3/getData", session, role, { type: "2", sizeType: "1" }, { query: true });
    const base = await this.accounts.api.roleRequest("/aki/roleBox/akiBox/baseData", session, role, {}, { multipart: true });
    const view = parseDaily(daily, base, role);
    await saveOptionalCache(this.queries.save(queryScope(session, role), "daily", view, "", view.updatedAt));
    this.#cache.set(key, view);
    return view;
  }
  async load(force = false, localOnly = false): Promise<DailyView> {
    const { session, role } = await this.accounts.context();
    if (!localOnly) {
      try {
        return await this.#load(session, role, force);
      } catch (error) {
        if (force || !(await this.queries.read(queryScope(session, role), "daily"))) throw error;
      }
    }
    const saved = await this.queries.read(queryScope(session, role), "daily");
    if (!saved) throw new Error("当前角色暂无本地每日数据");
    return { ...saved.data, roleName: role.roleName, cached: true };
  }
  async synchronize(): Promise<DailyView> {
    const { session, role } = await this.accounts.context();
    this.accounts.api.success(await this.accounts.api.send("/gamer/widget/game3/refresh", session, { type: "1", sizeType: "2" }, { query: true }));
    await this.accounts.api.roleRequest("/aki/roleBox/akiBox/refreshData", session, role, {}, { multipart: true, retryExpired: false });
    return this.#load(session, role, true);
  }
}
