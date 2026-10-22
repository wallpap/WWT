import { saveOptionalCache } from "./optional-cache.ts";
import type { AccountService } from "./accounts.ts";
import { bool, decode, number, object, text, type KuroRole, type KuroSession } from "./model.ts";
import { RoleCacheStore } from "./role-cache.ts";
import { queryCacheStore, queryScope, type QueryCacheStore } from "./query-cache.ts";
import { millisecondsPerMinute } from "../units.ts";
import { defaultCountryCode, kuroRoleChannelId } from "./constants.ts";

export interface KuroOwnedRole {
  roleId: string;
  name: string;
  level: number;
  breach: number;
  chainUnlocked: number;
  starLevel: number;
  attributeName: string;
  weaponTypeName: string;
  iconUrl: string;
  pictureUrl: string;
}

export interface KuroRoleAttribute {
  name: string;
  value: string;
  iconUrl: string;
}
export interface KuroRoleChain {
  name: string;
  order: number;
  description: string;
  unlocked: boolean;
}
export interface KuroRoleSkill {
  name: string;
  type: string;
  level: number;
  description: string;
  iconUrl: string;
}
export interface KuroRoleProp {
  name: string;
  value: string;
}
export interface KuroPhantom {
  name: string;
  level: number;
  quality: number;
  cost: number;
  iconUrl: string;
  skillDescription: string;
  mainProps: KuroRoleProp[];
  subProps: KuroRoleProp[];
}
export interface KuroWeapon {
  name: string;
  level: number;
  breach: number;
  resonLevel: number;
  starLevel: number;
  iconUrl: string;
  effectName: string;
  effectDescription: string;
}
export interface KuroRoleDetail {
  roleId: string;
  name: string;
  level: number;
  breach: number;
  starLevel: number;
  attributeName: string;
  weaponTypeName: string;
  iconUrl: string;
  pictureUrl: string;
  attributes: KuroRoleAttribute[];
  chains: KuroRoleChain[];
  skills: KuroRoleSkill[];
  weapon: KuroWeapon | null;
  phantoms: KuroPhantom[];
}
export interface KuroRoleView {
  roleId: string;
  roleName: string;
  updatedAt: number;
  roles: KuroOwnedRole[];
  detail: KuroRoleDetail | null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseOwnedRole(value: unknown): KuroOwnedRole {
  const row = object(value);
  const roleId = text(row["roleId"]);
  if (!roleId) throw new Error("角色列表缺少角色 ID");
  return {
    roleId,
    name: text(row["roleName"]) || "未命名角色",
    level: number(row["level"]),
    breach: number(row["breach"]),
    chainUnlocked: number(row["chainUnlockNum"]),
    starLevel: number(row["starLevel"]),
    attributeName: text(row["attributeName"]),
    weaponTypeName: text(row["weaponTypeName"]),
    iconUrl: text(row["roleIconUrl"]),
    pictureUrl: text(row["rolePicUrl"]),
  };
}

export function parseOwnedRoles(value: unknown): KuroOwnedRole[] {
  const decoded = decode(value);
  const data = object(decoded);
  const rows = data["roleList"] ?? data["roles"];
  if (!Array.isArray(rows)) throw new Error("角色列表格式无效");
  return rows.map(parseOwnedRole).sort((left, right) => right.level - left.level || left.name.localeCompare(right.name, "zh-CN"));
}

function parseProps(value: unknown): KuroRoleProp[] {
  return list(value).flatMap((item) => {
    const row = object(item);
    const name = text(row["attributeName"]);
    const prop = text(row["attributeValue"]);
    return name || prop ? [{ name, value: prop }] : [];
  });
}

export function parseRoleDetail(value: unknown, fallback: KuroOwnedRole): KuroRoleDetail {
  const decoded = decode(value);
  const data = object(decoded);
  const role = object(data["role"] ?? data);
  const roleId = text(role["roleId"]) || fallback.roleId;
  if (roleId !== fallback.roleId) throw new Error("角色详情与所选角色不匹配");
  const weaponData = data["weaponData"] == null ? null : object(data["weaponData"]);
  const weapon =
    weaponData && weaponData["weapon"] != null
      ? (() => {
          const item = object(weaponData["weapon"]);
          return {
            name: text(item["weaponName"]),
            level: number(weaponData["level"]),
            breach: number(weaponData["breach"]),
            resonLevel: number(weaponData["resonLevel"]),
            starLevel: number(item["weaponStarLevel"]),
            iconUrl: text(item["weaponIcon"]),
            effectName: text(item["weaponEffectName"]),
            effectDescription: text(item["effectDescription"]),
          } satisfies KuroWeapon;
        })()
      : null;
  const phantomData = data["phantomData"] == null ? null : object(data["phantomData"]);
  // 未装备的声骸槽位由接口返回 null。
  const phantoms = list(phantomData?.["equipPhantomList"]).filter((item) => item !== null).map((item) => {
    const row = object(item);
    const prop = row["phantomProp"] == null ? {} : object(row["phantomProp"]);
    return {
      name: text(prop["name"]),
      level: number(row["level"]),
      quality: number(row["quality"]) || number(prop["quality"]),
      cost: number(row["cost"]) || number(prop["cost"]),
      iconUrl: text(prop["iconUrl"]),
      skillDescription: text(prop["skillDescription"]),
      mainProps: parseProps(row["mainProps"]),
      subProps: parseProps(row["subProps"]),
    } satisfies KuroPhantom;
  });
  const chains = list(data["chainList"])
    .map((item) => {
      const row = object(item);
      return {
        name: text(row["name"]),
        order: number(row["order"]),
        description: text(row["description"]),
        unlocked: bool(row["unlocked"]),
      } satisfies KuroRoleChain;
    })
    .sort((left, right) => left.order - right.order);
  const attributes = list(data["roleAttributeList"]).map((item) => {
    const row = object(item);
    return {
      name: text(row["attributeName"]),
      value: text(row["attributeValue"]),
      iconUrl: text(row["iconUrl"]),
    } satisfies KuroRoleAttribute;
  });
  const skills = list(data["skillList"]).flatMap((item) => {
    const row = object(item);
    const skill = row["skill"] == null ? {} : object(row["skill"]);
    const name = text(skill["name"]);
    return name
      ? [
          {
            name,
            type: text(skill["type"]),
            level: number(row["level"]),
            description: text(skill["description"]),
            iconUrl: text(skill["iconUrl"]),
          },
        ]
      : [];
  });
  return {
    roleId,
    name: text(role["roleName"]) || fallback.name,
    level: number(data["level"]) || fallback.level,
    breach: number(role["breach"]) || fallback.breach,
    starLevel: number(role["starLevel"]) || fallback.starLevel,
    attributeName: text(role["attributeName"]) || fallback.attributeName,
    weaponTypeName: text(role["weaponTypeName"]) || fallback.weaponTypeName,
    iconUrl: text(role["roleIconUrl"]) || fallback.iconUrl,
    pictureUrl: text(role["rolePicUrl"]) || fallback.pictureUrl,
    attributes,
    chains,
    skills,
    weapon,
    phantoms,
  };
}

export class RoleService {
  #listCache = new Map<string, { roles: KuroOwnedRole[]; updatedAt: number }>();
  #detailCache = new Map<string, { detail: KuroRoleDetail; updatedAt: number }>();
  constructor(
    private readonly accounts: AccountService,
    private readonly store: Pick<RoleCacheStore, "read" | "saveList" | "saveDetail"> = new RoleCacheStore(),
    private readonly queries: Pick<QueryCacheStore, "read"> = queryCacheStore,
  ) {}

  async #context(): Promise<{ session: KuroSession; role: KuroRole }> {
    return this.accounts.context();
  }

  async load(force = false): Promise<KuroRoleView> {
    const { session, role } = await this.#context();
    const key = JSON.stringify([session.id, role.roleId, role.serverId]);
    let cached = this.#listCache.get(key);
    if (force || !cached || Date.now() - cached.updatedAt >= millisecondsPerMinute) {
      const raw = await this.accounts.api.roleRequest("/aki/roleBox/akiBox/roleData", session, role, {}, { multipart: true });
      cached = { roles: parseOwnedRoles(raw), updatedAt: Date.now() };
      await saveOptionalCache(this.store.saveList(key, cached));
      this.#listCache.set(key, cached);
    }
    const selected = cached.roles[0] ?? null;
    const detail = selected ? await this.#detail(session, role, selected, force) : null;
    return {
      roleId: role.roleId,
      roleName: role.roleName,
      updatedAt: cached.updatedAt,
      roles: cached.roles,
      detail,
    };
  }

  async local(): Promise<KuroRoleView> {
    const { session, role } = await this.#context();
    const saved = await this.store.read(JSON.stringify([session.id, role.roleId, role.serverId]));
    const imported = await this.queries.read(queryScope(session, role), "roles");
    if (!saved && !imported) throw new Error("当前角色暂无本地缓存，请先联网查询");
    if (imported && (!saved || imported.savedAt > saved.updatedAt)) {
      const selected = imported.data[0];
      const detail = selected ? await this.queries.read(queryScope(session, role), "role-detail", selected.roleId) : null;
      const previous = selected ? saved?.details[selected.roleId] : undefined;
      return {
        roleId: role.roleId,
        roleName: role.roleName,
        updatedAt: imported.savedAt,
        roles: imported.data,
        detail: previous && (!detail || previous.updatedAt >= detail.savedAt) ? previous.detail : (detail?.data ?? null),
      };
    }
    const current = saved!;
    return {
      roleId: role.roleId,
      roleName: role.roleName,
      updatedAt: current.updatedAt,
      roles: current.roles,
      detail: current.roles[0] ? (current.details[current.roles[0].roleId]?.detail ?? null) : null,
    };
  }

  async detail(roleId: string, localOnly = false): Promise<KuroRoleDetail> {
    const { session, role } = await this.#context();
    const key = JSON.stringify([session.id, role.roleId, role.serverId]);
    if (localOnly) {
      const saved = await this.store.read(key);
      const detail = saved?.details[roleId]?.detail;
      const imported = await this.queries.read(queryScope(session, role), "role-detail", roleId);
      if (imported && (!detail || imported.savedAt > saved!.details[roleId]!.updatedAt)) return imported.data;
      if (!detail) throw new Error("所选角色尚无本地详情，请联网查询");
      return detail;
    }
    const owned = this.#listCache.get(key)?.roles.find((item) => item.roleId === roleId);
    if (!owned) throw new Error("所选角色不存在");
    return this.#detail(session, role, owned, false);
  }

  async #detail(session: KuroSession, role: KuroRole, owned: KuroOwnedRole, force: boolean): Promise<KuroRoleDetail> {
    const key = JSON.stringify([session.id, role.roleId, role.serverId, owned.roleId]);
    const cached = this.#detailCache.get(key);
    if (!force && cached && Date.now() - cached.updatedAt < millisecondsPerMinute) return cached.detail;
    const raw = await this.accounts.api.roleRequest("/aki/roleBox/akiBox/getRoleDetail", session, role, { id: owned.roleId, channelId: kuroRoleChannelId, countryCode: defaultCountryCode }, { multipart: true });
    const detail = parseRoleDetail(raw, owned);
    const saved = { detail, updatedAt: Date.now() };
    await saveOptionalCache(this.store.saveDetail(JSON.stringify([session.id, role.roleId, role.serverId]), saved));
    this.#detailCache.set(key, saved);
    return detail;
  }
}
