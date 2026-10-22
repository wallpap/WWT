import type { AccountService } from "./accounts.ts";
import { object, text, serverId, type KuroRole, type KuroSession } from "./model.ts";
import { SignHistoryStore, signHistoryStore, legacySignKey, combineSignRecords, type SignRecord } from "./sign-store.ts";
import { queryCacheStore, queryScope, type QueryCacheStore } from "./query-cache.ts";
import { cachedToday } from "./cache-policy.ts";
import { saveOptionalCache } from "./optional-cache.ts";
import { kuroGameId } from "./constants.ts";

export interface SignView {
  accountId: string;
  roleId: string;
  serverId: string;
  roleName: string;
  signed: boolean;
  signDays: number;
  rewards: { name: string; count: string; received: boolean; iconUrl?: string }[];
  history: SignRecord[];
  cached?: boolean;
}
export interface SignResult {
  submitted: boolean;
  view: SignView | null;
  message: string;
}
export interface SignTarget {
  accountId: string;
  roleId: string;
  serverId: string;
  roleName: string;
}
export interface BatchSignItem {
  target: SignTarget;
  result: SignResult | null;
  error: string | null;
}

function month(): string {
  return new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
  }).format(new Date());
}
export function parseSignStatus(value: unknown) {
  const data = object(value);
  if (typeof data["isSigIn"] !== "boolean" || typeof data["sigInNum"] !== "number" || !Number.isSafeInteger(data["sigInNum"]) || data["sigInNum"] < 0 || !Array.isArray(data["signInGoodsConfigs"])) throw new Error("签到状态数据格式无效");
  const count = data["sigInNum"];
  return {
    signed: data["isSigIn"],
    signDays: count,
    rewards: data["signInGoodsConfigs"].map((value, index) => {
      const good = object(value);
      return {
        name: text(good["goodsName"]),
        count: text(good["goodsNum"]),
        received: index < count,
        ...(text(good["goodsUrl"]) ? { iconUrl: text(good["goodsUrl"]) } : {}),
      };
    }),
  };
}

export class SignService {
  #busy = false;
  #cache = new Map<string, { data: SignView; savedAt: number }>();
  #pending = new Map<string, Promise<SignView>>();
  constructor(
    private readonly accounts: AccountService,
    private readonly history: Pick<SignHistoryStore, "merge"> & Partial<Pick<SignHistoryStore, "list">> = signHistoryStore,
    private readonly queries: Pick<QueryCacheStore, "read"> & Partial<Pick<QueryCacheStore, "save">> = queryCacheStore,
    private readonly now: () => number = Date.now,
  ) {}
  #key(session: KuroSession, role: KuroRole): string {
    return JSON.stringify([session.id, queryScope(session, role)]);
  }
  async #cached(session: KuroSession, role: KuroRole): Promise<SignView | null> {
    const memory = this.#cache.get(this.#key(session, role));
    if (memory && cachedToday(memory.savedAt, this.now()))
      return memory.data.signed
        ? {
            ...structuredClone(memory.data),
            roleName: role.roleName,
            cached: true,
          }
        : null;
    try {
      const saved = await this.queries.read(queryScope(session, role), "sign-status");
      if (saved?.data.signed && cachedToday(saved.savedAt, this.now()))
        return {
          ...saved.data,
          accountId: session.id,
          roleId: role.roleId,
          serverId: role.serverId,
          roleName: role.roleName,
          cached: true,
        };
    } catch {
      /* 缓存损坏时继续联网，保留原文件。 */
    }
    return null;
  }
  async localHistory(): Promise<{
    roleName: string;
    history: SignRecord[];
    rewards: SignView["rewards"];
  }> {
    const { session, role } = await this.accounts.context();
    const current = (await this.history.list?.(JSON.stringify([session.id, role.roleId, role.serverId]))) ?? [];
    const legacy = role.serverId === serverId ? ((await this.history.list?.(legacySignKey(role.roleId))) ?? []) : [];
    const scope = queryScope(session, role);
    const imported = await this.queries.read(scope, "sign-records"),
      goods = await this.queries.read(scope, "sign-goods");
    const status = await this.queries.read(scope, "sign-status");
    return {
      roleName: role.roleName,
      history: combineSignRecords(imported?.data ?? [], legacy, current, status?.data.history ?? []),
      rewards: status?.data.rewards ?? goods?.data ?? [],
    };
  }
  async #request(path: string, session: KuroSession, role: KuroRole, extra: Record<string, string> = {}) {
    return this.accounts.api.success(
      await this.accounts.api.send(
        path,
        session,
        {
          gameId: kuroGameId,
          serverId: role.serverId,
          roleId: role.roleId,
          userId: role.userId,
          ...extra,
        },
        { query: true },
      ),
    );
  }
  async #fetch(session: KuroSession, role: KuroRole, knownStatus?: ReturnType<typeof parseSignStatus>): Promise<SignView> {
    const savedAt = this.now();
    const status = knownStatus ?? parseSignStatus(await this.#request("/encourage/signIn/initSignInV2", session, role));
    const raw = await this.#request("/encourage/signIn/queryRecordV2", session, role);
    if (!Array.isArray(raw)) throw new Error("签到历史格式无效");
    const records = raw.map((value) => {
      const entry = object(value);
      const date = text(entry["sigInDate"]);
      if (!date || !text(entry["goodsName"])) throw new Error("签到历史记录格式无效");
      return {
        orderCode: text(entry["orderCode"]),
        date,
        name: text(entry["goodsName"]),
        count: text(entry["goodsNum"]),
        ...(text(entry["goodsUrl"]) ? { iconUrl: text(entry["goodsUrl"]) } : {}),
      };
    });
    const current = await this.history.merge(JSON.stringify([session.id, role.roleId, role.serverId]), records);
    const legacy = role.serverId === serverId ? ((await this.history.list?.(legacySignKey(role.roleId))) ?? []) : [];
    const history = combineSignRecords(legacy, current);
    const view = {
      accountId: session.id,
      roleId: role.roleId,
      serverId: role.serverId,
      roleName: role.roleName,
      ...status,
      history,
    };
    this.#cache.set(this.#key(session, role), {
      data: structuredClone(view),
      savedAt,
    });
    if (this.queries.save) await saveOptionalCache(this.queries.save(queryScope(session, role), "sign-status", view, "", savedAt));
    return view;
  }
  async #load(session: KuroSession, role: KuroRole, force = false): Promise<SignView> {
    if (!force) {
      const cached = await this.#cached(session, role);
      if (cached) return cached;
    }
    const key = this.#key(session, role);
    const pending = this.#pending.get(key);
    if (pending) return pending;
    const operation = this.#fetch(session, role);
    this.#pending.set(key, operation);
    try {
      return await operation;
    } finally {
      this.#pending.delete(key);
    }
  }
  async load(force = false): Promise<SignView> {
    const { session, role } = await this.accounts.context();
    return this.#load(session, role, force);
  }
  async batchTargets(): Promise<SignTarget[]> {
    const view = await this.accounts.view();
    return view.accounts.flatMap((account) =>
      account.roles.map((role) => ({
        accountId: account.id,
        roleId: role.roleId,
        serverId: role.serverId,
        roleName: role.roleName,
      })),
    );
  }
  async #submit(session: KuroSession, role: KuroRole): Promise<SignResult> {
    const cached = await this.#cached(session, role);
    if (cached) return { submitted: false, view: cached, message: "当前角色今日已签到" };
    const status = parseSignStatus(await this.#request("/encourage/signIn/initSignInV2", session, role));
    if (status.signed)
      return {
        submitted: false,
        view: await this.#fetch(session, role, status),
        message: "当前角色今日已签到",
      };
    try {
      await this.#request("/encourage/signIn/v2", session, role, {
        reqMonth: month(),
      });
    } catch {
      throw new Error("签到结果未确认，请刷新签到状态后再试");
    }
    try {
      return {
        submitted: true,
        view: await this.#load(session, role, true),
        message: "签到成功",
      };
    } catch {
      return {
        submitted: true,
        view: null,
        message: "签到已成功，状态或历史刷新失败，请点击刷新状态",
      };
    }
  }
  async submitBatch(expected: SignTarget[], shouldSign: (target: SignTarget) => boolean = () => true): Promise<BatchSignItem[]> {
    if (this.#busy) throw new Error("正在签到，请等待完成");
    this.#busy = true;
    try {
      const targets = await this.batchTargets();
      if (!targets.length || JSON.stringify(targets) !== JSON.stringify(expected)) throw new Error("批量签到的账号或角色列表已变化，请重新查看列表");
      const results: BatchSignItem[] = [];
      for (const target of targets) {
        if (!shouldSign(target)) continue;
        try {
          const { session, role } = await this.accounts.context(target.accountId, target.roleId);
          if (role.serverId !== target.serverId) throw new Error("角色服务器已变化，请重新查询");
          results.push({
            target,
            result: await this.#submit(session, role),
            error: null,
          });
        } catch (error) {
          results.push({
            target,
            result: null,
            error: error instanceof Error ? error.message : "签到失败，请刷新状态",
          });
        }
      }
      return results;
    } finally {
      this.#busy = false;
    }
  }
  async submit(accountId: string, roleId: string, serverId: string): Promise<SignResult> {
    if (this.#busy) throw new Error("正在签到，请等待完成");
    this.#busy = true;
    try {
      const { session, role } = await this.accounts.context();
      if (session.id !== accountId || role.roleId !== roleId || role.serverId !== serverId) throw new Error("账号或角色已切换，请刷新签到状态");
      return await this.#submit(session, role);
    } finally {
      this.#busy = false;
    }
  }
}
