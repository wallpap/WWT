import { saveOptionalCache } from "./optional-cache.ts";
import { cachedToday } from "./cache-policy.ts";
import type { AccountService } from "./accounts.ts";
import { bool, decode, number, object, text, type KuroRole, type KuroSession } from "./model.ts";
import { parseRoleCultivation, type RoleCultivation } from "./cultivation.ts";
import { queryCacheStore, queryScope, type QueryCacheStore } from "./query-cache.ts";
import { calculatorTargetKey, calculatorTargetStore, validateRoleAim, validateWeaponAim, type CalculatorTarget, type CalculatorTargetStore, type CalculatorTargets } from "./calculator-targets.ts";
export { buildRoleAim, buildWeaponAim, calculatorSkillNames } from "./calculator-aim.ts";

export interface CalculatorRole {
  id: string;
  name: string;
  starLevel: number;
  attributeName: string;
  weaponTypeName: string;
  iconUrl: string;
  isPreview: boolean;
  isNew: boolean;
}
export interface CalculatorWeapon {
  id: string;
  name: string;
  type: number;
  starLevel: number;
  iconUrl: string;
  isPreview: boolean;
  isNew: boolean;
}
export interface SkillLevelUp {
  startLevel: number;
  endLevel: number;
}
export interface RoleAim {
  roleId: string;
  roleStartLevel: number;
  roleEndLevel: number;
  skillLevelUpList: SkillLevelUp[];
  advanceSkillList: string[];
  category: "all" | "self";
}
export interface WeaponAim {
  weaponId: string;
  weaponStartLevel: number;
  weaponEndLevel: number;
}
export interface CalculatorCost {
  id: string;
  name: string;
  count: number;
  quality: number;
  type: number;
  iconUrl: string;
  preview: boolean;
}
export interface CalculatorCostGroup {
  roleId: string | null;
  weaponId: string | null;
  allCost: CalculatorCost[];
  missingCost: CalculatorCost[];
  synthetic: CalculatorCost[];
}
export interface CalculatorResult {
  roleCount: number;
  weaponCount: number;
  preview: {
    allCost: CalculatorCost[];
    missingCost: CalculatorCost[];
    synthetic: CalculatorCost[];
  };
  costList: CalculatorCostGroup[];
}
export interface CalculatorView {
  roleName: string;
  updatedAt: number;
  roles: CalculatorRole[];
  weapons: CalculatorWeapon[];
  cached?: boolean;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function arrayData(value: unknown): unknown[] {
  const decoded = decode(value);
  if (Array.isArray(decoded)) return decoded;
  const data = object(decoded);
  return list(data["list"] ?? data["roleList"] ?? data["weaponList"] ?? data["data"]);
}

export function parseCalculatorRoles(value: unknown): CalculatorRole[] {
  return arrayData(value).map((item) => {
    const row = object(item);
    const id = text(row["roleId"]);
    if (!id) throw new Error("养成角色目录缺少角色 ID");
    return {
      id,
      name: text(row["roleName"]) || "未命名角色",
      starLevel: number(row["starLevel"]),
      attributeName: text(row["attributeName"]),
      weaponTypeName: text(row["weaponTypeName"]),
      iconUrl: text(row["roleIconUrl"]),
      isPreview: bool(row["isPreview"]),
      isNew: bool(row["isNew"]),
    } satisfies CalculatorRole;
  });
}

export function parseCalculatorWeapons(value: unknown): CalculatorWeapon[] {
  return arrayData(value).map((item) => {
    const row = object(item);
    const id = text(row["weaponId"]);
    if (!id) throw new Error("养成武器目录缺少武器 ID");
    return {
      id,
      name: text(row["weaponName"]) || "未命名武器",
      type: number(row["weaponType"]),
      starLevel: number(row["weaponStarLevel"]),
      iconUrl: text(row["weaponIcon"]),
      isPreview: bool(row["isPreview"]),
      isNew: bool(row["isNew"]),
    } satisfies CalculatorWeapon;
  });
}

function parseCosts(value: unknown): CalculatorCost[] {
  return list(value).flatMap((item) => {
    const row = object(item);
    const name = text(row["name"]);
    return name
      ? [
          {
            id: text(row["id"]),
            name,
            count: number(row["num"]),
            quality: number(row["quality"]),
            type: number(row["type"]),
            iconUrl: text(row["iconUrl"]),
            preview: bool(row["isPreview"]),
          },
        ]
      : [];
  });
}

export function parseCalculatorResult(value: unknown): CalculatorResult {
  const data = object(decode(value));
  const preview = data["preview"] == null ? {} : object(data["preview"]);
  const groups = list(data["costList"]).map((item) => {
    const row = object(item);
    return {
      roleId: text(row["roleId"]) || null,
      weaponId: text(row["weaponId"]) || null,
      allCost: parseCosts(row["allCost"]),
      missingCost: parseCosts(row["missingCost"]),
      synthetic: parseCosts(row["synthetic"]),
    } satisfies CalculatorCostGroup;
  });
  return {
    roleCount: number(data["roleNum"]),
    weaponCount: number(data["weaponNum"]),
    preview: {
      allCost: parseCosts(preview["allCost"]),
      missingCost: parseCosts(preview["missingCost"]),
      synthetic: parseCosts(preview["synthetic"]),
    },
    costList: groups,
  };
}

export class CalculatorService {
  #cache = new Map<string, CalculatorView>();
  constructor(
    private readonly accounts: AccountService,
    private readonly queries: Pick<QueryCacheStore, "read" | "save"> = queryCacheStore,
    private readonly targetsStore: CalculatorTargetStore = calculatorTargetStore,
  ) {}
  async #context(): Promise<{ session: KuroSession; role: KuroRole }> {
    return this.accounts.context();
  }

  async load(force = false, localOnly = false): Promise<CalculatorView> {
    const { session, role } = await this.#context();
    if (localOnly) {
      const scope = queryScope(session, role);
      const roles = await this.queries.read(scope, "calculator-roles"),
        weapons = await this.queries.read(scope, "calculator-weapons");
      if (!roles && !weapons) throw new Error("当前角色暂无本地养成目录");
      return {
        roleName: role.roleName,
        updatedAt: Math.min(roles?.savedAt ?? Infinity, weapons?.savedAt ?? Infinity),
        roles: roles?.data ?? [],
        weapons: weapons?.data ?? [],
        cached: true,
      };
    }
    const key = `${session.id}:${role.roleId}:${role.serverId}`;
    const cached = this.#cache.get(key);
    if (!force && cached && cachedToday(cached.updatedAt)) return cached;
    if (!force) {
      try {
        const scope = queryScope(session, role);
        const [roles, weapons] = await Promise.all([this.queries.read(scope, "calculator-roles"), this.queries.read(scope, "calculator-weapons")]);
        if (roles && weapons && cachedToday(roles.savedAt) && cachedToday(weapons.savedAt)) {
          const view = {
            roleName: role.roleName,
            updatedAt: Math.min(roles.savedAt, weapons.savedAt),
            roles: roles.data,
            weapons: weapons.data,
            cached: true,
          };
          this.#cache.set(key, view);
          return view;
        }
      } catch {
        /* 缓存读取失败时重新查询目录。 */
      }
    }
    const [roles, weapons] = await Promise.all([this.accounts.api.roleRequest("/aki/calculator/listRole", session, role), this.accounts.api.roleRequest("/aki/calculator/listWeapon", session, role)]);
    const view = {
      roleName: role.roleName,
      updatedAt: Date.now(),
      roles: parseCalculatorRoles(roles),
      weapons: parseCalculatorWeapons(weapons),
    } satisfies CalculatorView;
    await saveOptionalCache(this.queries.save(queryScope(session, role), "calculator-roles", view.roles, "", view.updatedAt));
    await saveOptionalCache(this.queries.save(queryScope(session, role), "calculator-weapons", view.weapons, "", view.updatedAt));
    this.#cache.set(key, view);
    return view;
  }

  async roleCost(aim: RoleAim): Promise<CalculatorResult> {
    return this.roleCosts([aim]);
  }

  async roleCosts(aims: readonly RoleAim[]): Promise<CalculatorResult> {
    if (!aims.length) throw new Error("请先添加角色养成目标");
    const validated = aims.map(validateRoleAim);
    const { session, role } = await this.#context();
    const raw = await this.accounts.api.roleRequest("/aki/calculator/batchRoleCost", session, role, { content: JSON.stringify(validated) });
    return parseCalculatorResult(raw);
  }

  async cultivation(roleId: string): Promise<RoleCultivation> {
    if (!/^\d+$/.test(roleId)) throw new Error("角色 ID 无效");
    const { session, role } = await this.#context();
    const raw = await this.accounts.api.roleRequest("/aki/calculator/roleCultivateStatus", session, role, { userId: role.userId, ids: roleId }, { query: true });
    return parseRoleCultivation(raw, roleId);
  }

  async weaponCost(aim: WeaponAim): Promise<CalculatorResult> {
    return this.weaponCosts([aim]);
  }

  async weaponCosts(aims: readonly WeaponAim[]): Promise<CalculatorResult> {
    if (!aims.length) throw new Error("请先添加武器养成目标");
    const validated = aims.map(validateWeaponAim);
    const { session, role } = await this.#context();
    const raw = await this.accounts.api.roleRequest("/aki/calculator/batchWeaponCost", session, role, { content: JSON.stringify(validated) });
    return parseCalculatorResult(raw);
  }

  async targets(): Promise<CalculatorTargets> {
    const { role } = await this.#context();
    return this.targetsStore.list(calculatorTargetKey(role));
  }
  async saveTarget(target: CalculatorTarget): Promise<CalculatorTargets> {
    const { role } = await this.#context();
    return this.targetsStore.save(calculatorTargetKey(role), target);
  }
  async removeTarget(kind: "role" | "weapon", id: string): Promise<CalculatorTargets> {
    const { role } = await this.#context();
    return this.targetsStore.remove(calculatorTargetKey(role), kind, id);
  }
}
