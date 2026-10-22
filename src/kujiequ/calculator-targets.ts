import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { appPaths } from "../platform/app-paths.ts";
import { buildRoleAim, buildWeaponAim } from "./calculator-aim.ts";
import type { RoleAim, WeaponAim } from "./calculator.ts";
import { object, type KuroRole } from "./model.ts";

export interface CalculatorTargets {
  roles: RoleAim[];
  weapons: WeaponAim[];
}
export type CalculatorTarget = { kind: "role"; aim: RoleAim } | { kind: "weapon"; aim: WeaponAim };
export function calculatorTargetKey(role: KuroRole): string {
  return JSON.stringify([role.userId, role.roleId, role.serverId]);
}
export function validateRoleAim(aim: RoleAim): RoleAim {
  return buildRoleAim(aim.roleId, aim.roleStartLevel, aim.roleEndLevel, aim.skillLevelUpList, aim.advanceSkillList, aim.category);
}
export function validateWeaponAim(aim: WeaponAim): WeaponAim {
  return buildWeaponAim(aim.weaponId, aim.weaponStartLevel, aim.weaponEndLevel);
}

function parseTargets(value: unknown): CalculatorTargets {
  const row = object(value);
  if (!Array.isArray(row["roles"]) || !Array.isArray(row["weapons"])) throw new Error("养成目标存储格式无效");
  const roles = (row["roles"] as RoleAim[]).map(validateRoleAim);
  const weapons = (row["weapons"] as WeaponAim[]).map(validateWeaponAim);
  if (new Set(roles.map((aim) => aim.roleId)).size !== roles.length || new Set(weapons.map((aim) => aim.weaponId)).size !== weapons.length) throw new Error("养成目标存在重复条目");
  return { roles, weapons };
}

export class CalculatorTargetStore {
  #queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path = join(appPaths.dataDirectory, "kujiequ-calculator-targets.json")) {}
  async #read(): Promise<Record<string, unknown>> {
    try {
      return object(JSON.parse(await readFile(this.path, "utf8")) as unknown);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
      throw new Error("读取养成目标失败", { cause: error });
    }
  }
  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation);
    this.#queue = result.catch(() => {});
    return result;
  }
  async #write(stored: Record<string, unknown>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${crypto.randomUUID()}.tmp`;
    try {
      await Bun.write(temporary, `${JSON.stringify(stored, null, 2)}\n`);
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  list(key: string): Promise<CalculatorTargets> {
    return this.#serialize(async () => parseTargets((await this.#read())[key] ?? { roles: [], weapons: [] }));
  }
  save(key: string, target: CalculatorTarget): Promise<CalculatorTargets> {
    return this.#serialize(async () => {
      const stored = await this.#read();
      const targets = parseTargets(stored[key] ?? { roles: [], weapons: [] });
      if (target.kind === "role") {
        const aim = validateRoleAim(target.aim);
        targets.roles = [...targets.roles.filter((item) => item.roleId !== aim.roleId), aim];
      } else if (target.kind === "weapon") {
        const aim = validateWeaponAim(target.aim);
        targets.weapons = [...targets.weapons.filter((item) => item.weaponId !== aim.weaponId), aim];
      } else throw new Error("养成目标类型无效");
      stored[key] = targets;
      await this.#write(stored);
      return targets;
    });
  }
  remove(key: string, kind: "role" | "weapon", id: string): Promise<CalculatorTargets> {
    return this.#serialize(async () => {
      const stored = await this.#read();
      const targets = parseTargets(stored[key] ?? { roles: [], weapons: [] });
      if (kind === "role") targets.roles = targets.roles.filter((aim) => aim.roleId !== id);
      else if (kind === "weapon") targets.weapons = targets.weapons.filter((aim) => aim.weaponId !== id);
      else throw new Error("养成目标类型无效");
      stored[key] = targets;
      await this.#write(stored);
      return targets;
    });
  }
}
export const calculatorTargetStore = new CalculatorTargetStore();
