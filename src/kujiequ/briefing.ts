import { saveOptionalCache } from "./optional-cache.ts";
import type { AccountService } from "./accounts.ts";
import { decode, number, object, text } from "./model.ts";
import { queryCacheStore, queryScope, type QueryCacheStore } from "./query-cache.ts";
import { summarizeBriefingHistory, type BriefingHistory } from "./briefing-history.ts";

export type BriefingKind = "week" | "month" | "version";
export interface BriefingPeriod {
  title: string;
  index: string;
}
export interface BriefingPeriods {
  weeks: BriefingPeriod[];
  months: BriefingPeriod[];
  versions: BriefingPeriod[];
  cached?: boolean;
}
export interface BriefingItem {
  kind: string;
  count: number;
}
export interface BriefingRecord {
  totalCoin: number;
  totalStar: number;
  coinItems: BriefingItem[];
  starItems: BriefingItem[];
  description: string;
}
export interface BriefingView {
  kind: BriefingKind;
  period: BriefingPeriod;
  record: BriefingRecord;
  updatedAt: number;
  cached?: boolean;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function parsePeriods(value: unknown): BriefingPeriod[] {
  return list(value).map((item) => {
    const row = object(item);
    const index = text(row["index"]) || text(row["id"]);
    if (!index) throw new Error("资源简报周期缺少索引");
    return { title: text(row["title"]) || index, index };
  });
}

export function parseBriefingPeriods(value: unknown): BriefingPeriods {
  const data = object(decode(value));
  return {
    weeks: parsePeriods(data["weeks"] ?? data["weekList"]),
    months: parsePeriods(data["months"] ?? data["monthList"]),
    versions: parsePeriods(data["versions"] ?? data["versionList"]),
  };
}

function parseItems(value: unknown): BriefingItem[] {
  return list(value).flatMap((item) => {
    const row = object(item);
    const kind = text(row["type"]) || text(row["kind"]) || text(row["name"]);
    return kind ? [{ kind, count: number(row["num"] ?? row["count"]) }] : [];
  });
}

export function parseBriefingRecord(value: unknown): BriefingRecord {
  const data = object(decode(value));
  return {
    totalCoin: number(data["totalCoin"] ?? data["totalAsterite"]),
    totalStar: number(data["totalStar"] ?? data["totalAstrite"]),
    coinItems: parseItems(data["coinList"] ?? data["coinItems"]),
    starItems: parseItems(data["starList"] ?? data["starItems"]),
    description: text(data["copyWriting"] ?? data["description"]),
  };
}

function periodsFor(periods: BriefingPeriods, kind: BriefingKind): BriefingPeriod[] {
  return kind === "week" ? periods.weeks : kind === "month" ? periods.months : periods.versions;
}

export class BriefingService {
  #periodCache = new Map<string, BriefingPeriods>();
  #recordCache = new Map<string, BriefingView>();
  constructor(
    private readonly accounts: AccountService,
    private readonly queries: Pick<QueryCacheStore, "read" | "save" | "list"> = queryCacheStore,
  ) {}

  async periods(force = false, localOnly = false): Promise<BriefingPeriods> {
    const { session, role } = await this.accounts.context();
    if (localOnly) {
      const saved = await this.queries.read(queryScope(session, role), "briefing");
      if (!saved) throw new Error("当前角色暂无本地简报目录");
      return { ...saved.data, cached: true };
    }
    const key = JSON.stringify([session.id, role.roleId, role.serverId]);
    const cached = this.#periodCache.get(key);
    if (!force && cached) return cached;
    const data = this.accounts.api.success(await this.accounts.api.get("/aki/resource/period/list", session));
    const result = parseBriefingPeriods(data);
    await saveOptionalCache(this.queries.save(queryScope(session, role), "briefing", result));
    this.#periodCache.set(key, result);
    return result;
  }

  async detail(kind: BriefingKind, index: string, force = false, localOnly = false): Promise<BriefingView> {
    if (!["week", "month", "version"].includes(kind) || !/^[\w.-]+$/.test(index)) throw new Error("资源简报周期索引无效");
    const { session, role } = await this.accounts.context();
    if (localOnly) {
      const saved = await this.queries.read(queryScope(session, role), "briefing-detail", `${kind}:${index}`);
      if (!saved) throw new Error("所选周期暂无本地简报详情");
      const periods = await this.periods(false, true);
      return {
        ...saved.data,
        period: periodsFor(periods, kind).find((item) => item.index === index) ?? saved.data.period,
        cached: true,
      };
    }
    const key = `${session.id}:${role.roleId}:${role.serverId}:${kind}:${index}`;
    const cached = this.#recordCache.get(key);
    if (!force && cached) return cached;
    const endpoint = kind === "week" ? "/aki/resource/week" : kind === "month" ? "/aki/resource/month" : "/aki/resource/version";
    const data = await this.accounts.api.roleRequest(endpoint, session, role, {
      period: index,
    });
    const periods = await this.periods();
    const period = periodsFor(periods, kind).find((item) => item.index === index) ?? { title: index, index };
    const result = {
      kind,
      period,
      record: parseBriefingRecord(data),
      updatedAt: Date.now(),
    } satisfies BriefingView;
    await saveOptionalCache(this.queries.save(queryScope(session, role), "briefing-detail", result, `${kind}:${index}`, result.updatedAt));
    this.#recordCache.set(key, result);
    return result;
  }

  async history(kind: BriefingKind, synchronize = false, onProgress?: (completed: number, total: number) => void): Promise<BriefingHistory> {
    if (!["week", "month", "version"].includes(kind)) throw new Error("资源简报周期类型无效");
    const { session, role } = await this.accounts.context();
    const scope = queryScope(session, role);
    if (synchronize) {
      const periods = parseBriefingPeriods(this.accounts.api.success(await this.accounts.api.get("/aki/resource/period/list", session)));
      await saveOptionalCache(this.queries.save(scope, "briefing", periods));
      this.#periodCache.set(JSON.stringify([session.id, role.roleId, role.serverId]), periods);
      const selected = periodsFor(periods, kind);
      const endpoint = kind === "week" ? "/aki/resource/week" : kind === "month" ? "/aki/resource/month" : "/aki/resource/version";
      for (const [index, period] of selected.entries()) {
        if (!/^[\w.-]+$/.test(period.index)) throw new Error("资源简报周期索引无效");
        const current = await this.accounts.context();
        if (current.session.id !== session.id || current.role.roleId !== role.roleId || current.role.serverId !== role.serverId) throw new Error("角色已切换，已保存完成的周期，历史同步已停止");
        if (!(await this.queries.read(scope, "briefing-detail", `${kind}:${period.index}`))) {
          const raw = await this.accounts.api.roleRequest(endpoint, session, role, { period: period.index });
          const view: BriefingView = {
            kind,
            period,
            record: parseBriefingRecord(raw),
            updatedAt: Date.now(),
          };
          await saveOptionalCache(this.queries.save(scope, "briefing-detail", view, `${kind}:${period.index}`, view.updatedAt));
          this.#recordCache.set(`${session.id}:${role.roleId}:${role.serverId}:${kind}:${period.index}`, view);
        }
        onProgress?.(index + 1, selected.length);
      }
    }
    const entries = await this.queries.list(scope, "briefing-detail");
    return summarizeBriefingHistory(
      entries.map((entry) => ({ ...entry.data, cached: true })),
      kind,
    );
  }
}
