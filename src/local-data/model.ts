export const battleFields = {
  roleChange: "切换角色",
  roleDeath: "角色死亡",
  battle: "战斗",
  phantomGet: "获取声骸",
  phantomCallSkill: "召唤声骸技能",
  phantomTransformSkill: "变身声骸技能",
  paralysis: "怪物瘫痪",
  transfer: "传送",
  parryFront: "前闪避",
  parryBack: "后闪避",
  parryAttack: "闪避反击",
  usedStrength: "消耗体力",
} as const;
export type BattleCounters = Record<keyof typeof battleFields, number>;
export interface BattleRecord extends BattleCounters {
  roleId: string | null;
  date: string;
  monthCard: boolean;
  monthCardRemainDays: number;
}
export interface LocalPlayer {
  roleId: string;
  name: string;
  level: number;
  sex: number;
  headPhoto: string;
  region: string;
  updatedAt: number;
}
export interface CatalogRole {
  roleId: string;
  name: string;
  iconUrl: string;
  pictureUrl: string;
  starLevel: number;
  attributeId: number;
  attributeName: string;
  weaponTypeId: number;
  weaponTypeName: string;
  acronym: string;
  breach: number;
}
export interface LocalArchive {
  battles: BattleRecord[];
  players: LocalPlayer[];
  roles: CatalogRole[];
}
export function emptyArchive(): LocalArchive {
  return { battles: [], players: [], roles: [] };
}
export function validDate(date: string): boolean {
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("本地档案格式无效");
  return value as Record<string, unknown>;
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("本地档案整数无效");
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("本地档案文本无效");
  return value;
}
function id(value: unknown): string {
  const value_ = text(value);
  if (!/^\d+$/.test(value_)) throw new Error("本地档案角色 ID 无效");
  return value_;
}
function rows(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("本地档案列表无效");
  return value;
}
export function parseArchive(value: unknown): LocalArchive {
  const archive = record(value);
  return {
    battles: rows(archive["battles"]).map((item) => {
      const row = record(item),
        date = text(row["date"]);
      if (!validDate(date) || typeof row["monthCard"] !== "boolean") throw new Error("战斗记录日期或月卡状态无效");
      const counters = Object.fromEntries(Object.keys(battleFields).map((key) => [key, integer(row[key])])) as BattleCounters;
      return {
        ...counters,
        roleId: row["roleId"] === null ? null : id(row["roleId"]),
        date,
        monthCard: row["monthCard"],
        monthCardRemainDays: integer(row["monthCardRemainDays"]),
      };
    }),
    players: rows(archive["players"]).map((item) => {
      const row = record(item);
      return {
        roleId: id(row["roleId"]),
        name: text(row["name"]),
        level: integer(row["level"]),
        sex: integer(row["sex"]),
        headPhoto: text(row["headPhoto"]),
        region: text(row["region"]),
        updatedAt: integer(row["updatedAt"]),
      };
    }),
    roles: rows(archive["roles"]).map((item) => {
      const row = record(item);
      return {
        roleId: id(row["roleId"]),
        name: text(row["name"]),
        iconUrl: text(row["iconUrl"]),
        pictureUrl: text(row["pictureUrl"]),
        starLevel: integer(row["starLevel"]),
        attributeId: integer(row["attributeId"]),
        attributeName: text(row["attributeName"]),
        weaponTypeId: integer(row["weaponTypeId"]),
        weaponTypeName: text(row["weaponTypeName"]),
        acronym: text(row["acronym"]),
        breach: integer(row["breach"]),
      };
    }),
  };
}
export function summarizeBattles(records: readonly BattleRecord[]): BattleCounters {
  return Object.fromEntries(Object.keys(battleFields).map((key) => [key, records.reduce((sum, row) => sum + row[key as keyof BattleCounters], 0)])) as BattleCounters;
}
