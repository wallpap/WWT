import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { appPaths } from "../platform/app-paths.ts";
import { object, type KuroRole, type KuroSession } from "./model.ts";
import type { DailyView } from "./daily.ts";
import type { KuroOwnedRole, KuroRoleDetail } from "./role.ts";
import type { TowerView, SlashView, NewTowerView } from "./challenge.ts";
import type { SignRecord } from "./sign-store.ts";
import type { SignView } from "./sign.ts";
import type { BriefingPeriods, BriefingView } from "./briefing.ts";
import type { CalculatorRole, CalculatorWeapon } from "./calculator.ts";

export interface QueryScope {
  userId: string;
  roleId: string;
  serverId: string;
  source: "h5" | "android";
}
export function queryScope(session: KuroSession, role: KuroRole): QueryScope {
  return {
    userId: role.userId,
    roleId: role.roleId,
    serverId: role.serverId,
    source: session.source,
  };
}
interface QueryPayloads {
  daily: DailyView;
  roles: KuroOwnedRole[];
  "role-detail": KuroRoleDetail;
  tower: TowerView;
  slash: SlashView;
  matrix: NewTowerView;
  "sign-records": SignRecord[];
  "sign-goods": SignView["rewards"];
  "sign-status": Pick<SignView, "signed" | "signDays" | "rewards" | "history">;
  briefing: BriefingPeriods;
  "briefing-detail": BriefingView;
  "calculator-roles": CalculatorRole[];
  "calculator-weapons": CalculatorWeapon[];
}
export type QueryKind = keyof QueryPayloads;
export type CachedQuery = {
  [K in QueryKind]: {
    kind: K;
    data: QueryPayloads[K];
    scope: QueryScope;
    parameter: string;
    savedAt: number;
  };
}[QueryKind];

type Shape = "string" | "number" | "boolean" | { fields: Record<string, Shape> } | { items: Shape } | { nullable: Shape } | { optional: Shape };
const fields = (value: Record<string, Shape>): Shape => ({ fields: value });
const list = (value: Shape): Shape => ({ items: value });
const metric = list(fields({ name: "string", value: "string", icon: { optional: "string" }, iconUrl: { optional: "string" } }));
const roleFields: Record<string, Shape> = {
  roleId: "string",
  name: "string",
  level: "number",
  breach: "number",
  starLevel: "number",
  attributeName: "string",
  weaponTypeName: "string",
  iconUrl: "string",
  pictureUrl: "string",
};
const property = list(fields({ name: "string", value: "string" }));
const period = fields({ title: "string", index: "string" });
const briefingItems = list(fields({ kind: "string", count: "number" }));
const teamRoles: Shape = {
  optional: list(
    fields({
      id: "string",
      name: "string",
      iconUrl: "string",
      skillBranch: { nullable: "number" },
    }),
  ),
};
const teamBuffs: Shape = {
  optional: list(
    fields({
      id: "string",
      name: "string",
      description: "string",
      iconUrl: "string",
      quality: "number",
    }),
  ),
};
const shapes: Record<QueryKind, Shape> = {
  daily: fields({
    roleId: "string",
    roleName: "string",
    updatedAt: "number",
    metrics: metric,
    base: metric,
    boxes: metric,
  }),
  roles: list(fields({ ...roleFields, chainUnlocked: "number" })),
  "role-detail": fields({
    ...roleFields,
    attributes: list(fields({ name: "string", value: "string", iconUrl: "string" })),
    chains: list(
      fields({
        name: "string",
        order: "number",
        description: "string",
        unlocked: "boolean",
      }),
    ),
    skills: list(
      fields({
        name: "string",
        type: "string",
        level: "number",
        description: "string",
        iconUrl: "string",
      }),
    ),
    weapon: {
      nullable: fields({
        name: "string",
        level: "number",
        breach: "number",
        resonLevel: "number",
        starLevel: "number",
        iconUrl: "string",
        effectName: "string",
        effectDescription: "string",
      }),
    },
    phantoms: list(
      fields({
        name: "string",
        level: "number",
        quality: "number",
        cost: "number",
        iconUrl: "string",
        skillDescription: "string",
        mainProps: property,
        subProps: property,
      }),
    ),
  }),
  tower: fields({
    unlocked: "boolean",
    seasonEndTime: "number",
    areas: list(
      fields({
        name: "string",
        stars: "number",
        maxStars: "number",
        floors: list(
          fields({
            floor: "string",
            stars: "number",
            roleCount: "number",
            roles: teamRoles,
          }),
        ),
      }),
    ),
  }),
  slash: fields({
    unlocked: "boolean",
    seasonEndTime: "number",
    difficulties: list(
      fields({
        name: "string",
        score: "number",
        maxScore: "number",
        challenges: list(
          fields({
            name: "string",
            score: "number",
            rank: "string",
            halves: list(
              fields({
                name: "string",
                score: "number",
                roleCount: "number",
                roles: teamRoles,
                buffs: teamBuffs,
              }),
            ),
          }),
        ),
      }),
    ),
  }),
  matrix: fields({
    unlocked: "boolean",
    endTime: "number",
    reward: "number",
    totalReward: "number",
    modes: list(
      fields({
        modeId: "number",
        score: "number",
        rank: "number",
        round: "number",
        passBoss: "number",
        bossCount: "number",
        hasRecord: "boolean",
        teams: list(
          fields({
            score: "number",
            round: "number",
            passBoss: "number",
            roleCount: "number",
            bossCount: { optional: "number" },
            roles: teamRoles,
            buffs: teamBuffs,
          }),
        ),
      }),
    ),
  }),
  "sign-records": list(
    fields({
      orderCode: "string",
      date: "string",
      name: "string",
      count: "string",
      iconUrl: { optional: "string" },
    }),
  ),
  "sign-goods": list(fields({ name: "string", count: "string", received: "boolean", iconUrl: { optional: "string" } })),
  "sign-status": fields({
    signed: "boolean",
    signDays: "number",
    rewards: list(fields({ name: "string", count: "string", received: "boolean", iconUrl: { optional: "string" } })),
    history: list(
      fields({
        orderCode: "string",
        date: "string",
        name: "string",
        count: "string",
        iconUrl: { optional: "string" },
      }),
    ),
  }),
  briefing: fields({
    weeks: list(period),
    months: list(period),
    versions: list(period),
  }),
  "briefing-detail": fields({
    kind: "string",
    period,
    updatedAt: "number",
    record: fields({
      totalCoin: "number",
      totalStar: "number",
      coinItems: briefingItems,
      starItems: briefingItems,
      description: "string",
    }),
  }),
  "calculator-roles": list(
    fields({
      id: "string",
      name: "string",
      starLevel: "number",
      attributeName: "string",
      weaponTypeName: "string",
      iconUrl: "string",
      isPreview: "boolean",
      isNew: "boolean",
    }),
  ),
  "calculator-weapons": list(
    fields({
      id: "string",
      name: "string",
      type: "number",
      starLevel: "number",
      iconUrl: "string",
      isPreview: "boolean",
      isNew: "boolean",
    }),
  ),
};

function project(value: unknown, shape: Shape): unknown {
  if (typeof shape === "string") {
    if (typeof value !== shape || (typeof value === "number" && !Number.isFinite(value))) throw new Error("业务缓存字段无效");
    return value;
  }
  if ("nullable" in shape) return value === null ? null : project(value, shape.nullable);
  if ("optional" in shape) return value === undefined ? undefined : project(value, shape.optional);
  if ("items" in shape) {
    if (!Array.isArray(value)) throw new Error("业务缓存列表无效");
    return value.map((item) => project(item, shape.items));
  }
  const row = object(value);
  return Object.fromEntries(Object.entries(shape.fields).map(([key, descriptor]) => [key, project(row[key], descriptor)]));
}
function key(entry: Pick<CachedQuery, "scope" | "kind" | "parameter">): string {
  const { userId, roleId, serverId, source } = entry.scope;
  return JSON.stringify([userId, roleId, serverId, source, entry.kind, entry.parameter]);
}
export function parseCachedQuery(value: unknown): CachedQuery {
  const row = object(value),
    scope = object(row["scope"]);
  if (typeof scope["userId"] !== "string" || !/^\d+$/.test(scope["userId"]) || typeof scope["roleId"] !== "string" || !/^\d+$/.test(scope["roleId"]) || typeof scope["serverId"] !== "string" || !scope["serverId"] || !["h5", "android"].includes(String(scope["source"])) || typeof row["kind"] !== "string" || !Object.hasOwn(shapes, row["kind"]) || typeof row["parameter"] !== "string" || typeof row["savedAt"] !== "number" || !Number.isSafeInteger(row["savedAt"]) || row["savedAt"] < 0 || !Number.isFinite(new Date(row["savedAt"]).getTime())) throw new Error("业务缓存归属或时间无效");
  const kind = row["kind"] as QueryKind,
    parameter = row["parameter"];
  if (kind === "role-detail" ? !/^\d+$/.test(parameter) : kind === "briefing-detail" ? !/^(week|month|version):[\w.-]+$/.test(parameter) : parameter !== "") throw new Error("业务缓存查询参数无效");
  const data = project(row["data"], shapes[kind]);
  if (kind === "role-detail" && object(data)["roleId"] !== parameter) throw new Error("业务缓存角色详情归属无效");
  if (kind === "daily" && object(data)["roleId"] !== scope["roleId"]) throw new Error("业务缓存每日数据归属无效");
  if (kind === "briefing-detail" && `${object(data)["kind"]}:${object(object(data)["period"])["index"]}` !== parameter) throw new Error("业务缓存简报周期无效");
  return {
    scope: {
      userId: scope["userId"],
      roleId: scope["roleId"],
      serverId: scope["serverId"],
      source: scope["source"] as QueryScope["source"],
    },
    kind,
    parameter,
    savedAt: row["savedAt"],
    data,
  } as CachedQuery;
}

export class QueryCacheStore {
  #queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path = join(appPaths.dataDirectory, "kujiequ-query-cache.json")) {}
  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation);
    this.#queue = result.catch(() => {});
    return result;
  }
  async #read(): Promise<CachedQuery[]> {
    try {
      const data: unknown = JSON.parse(await readFile(this.path, "utf8"));
      if (!Array.isArray(data)) throw new Error();
      return data.map(parseCachedQuery);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw new Error("读取本地业务缓存失败");
    }
  }
  read<K extends QueryKind>(scope: QueryScope, kind: K, parameter = ""): Promise<{ data: QueryPayloads[K]; savedAt: number } | null> {
    return this.#serialize(async () => {
      const entry = (await this.#read()).find((item) => key(item) === key({ scope, kind, parameter }));
      return entry ? { data: entry.data as QueryPayloads[K], savedAt: entry.savedAt } : null;
    });
  }
  async save<K extends QueryKind>(scope: QueryScope, kind: K, data: QueryPayloads[K], parameter = "", savedAt = Date.now()): Promise<void> {
    await this.#merge([{ scope, kind, data, parameter, savedAt } as CachedQuery]);
  }
  list<K extends QueryKind>(scope: QueryScope, kind: K): Promise<{ data: QueryPayloads[K]; parameter: string; savedAt: number }[]> {
    return this.#serialize(async () =>
      (await this.#read())
        .filter((entry) => entry.kind === kind && entry.scope.userId === scope.userId && entry.scope.roleId === scope.roleId && entry.scope.serverId === scope.serverId && entry.scope.source === scope.source)
        .map((entry) => ({
          data: entry.data as QueryPayloads[K],
          parameter: entry.parameter,
          savedAt: entry.savedAt,
        })),
    );
  }
  #merge(incoming: readonly CachedQuery[]): Promise<{ addedCount: number; duplicateCount: number }> {
    return this.#serialize(async () => {
      const validated = incoming.map(parseCachedQuery);
      const records = new Map((await this.#read()).map((entry) => [key(entry), entry]));
      let addedCount = 0;
      for (const entry of validated) {
        const previous = records.get(key(entry));
        if (previous && previous.savedAt >= entry.savedAt) continue;
        records.set(key(entry), entry);
        addedCount++;
      }
      if (addedCount) {
        await mkdir(dirname(this.path), { recursive: true });
        const temporary = `${this.path}.${crypto.randomUUID()}.tmp`;
        try {
          await Bun.write(temporary, `${JSON.stringify([...records.values()], null, 2)}\n`);
          await rename(temporary, this.path);
        } finally {
          await rm(temporary, { force: true });
        }
      }
      return { addedCount, duplicateCount: incoming.length - addedCount };
    });
  }
}
export const queryCacheStore = new QueryCacheStore();
