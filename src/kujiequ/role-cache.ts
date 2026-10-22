import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { appPaths } from "../platform/app-paths.ts";
import { object } from "./model.ts";
import type { KuroOwnedRole, KuroRoleDetail } from "./role.ts";

export interface SavedRoleList {
  roles: KuroOwnedRole[];
  updatedAt: number;
}
export interface SavedRoleDetail {
  detail: KuroRoleDetail;
  updatedAt: number;
}
interface RoleSnapshot extends SavedRoleList {
  details: Record<string, SavedRoleDetail>;
}

function fields(value: unknown, strings: string[], numbers: string[] = []): Record<string, unknown> {
  const row = object(value);
  if (strings.some((key) => typeof row[key] !== "string") || numbers.some((key) => typeof row[key] !== "number" || !Number.isFinite(row[key]))) throw new Error("本地角色缓存字段无效");
  return row;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("本地角色缓存列表无效");
  return value;
}
const roleStrings = ["roleId", "name", "attributeName", "weaponTypeName", "iconUrl", "pictureUrl"];
const roleNumbers = ["level", "breach", "starLevel"];
function snapshot(value: unknown): RoleSnapshot {
  const row = fields(value, [], ["updatedAt"]);
  const ids = new Set(list(row["roles"]).map((item) => fields(item, roleStrings, [...roleNumbers, "chainUnlocked"])["roleId"]));
  for (const [id, saved] of Object.entries(object(row["details"]))) {
    const entry = fields(saved, [], ["updatedAt"]);
    const detail = fields(entry["detail"], roleStrings, roleNumbers);
    if (detail["roleId"] !== id || !ids.has(id)) throw new Error("本地角色详情归属无效");
    for (const item of list(detail["attributes"])) fields(item, ["name", "value", "iconUrl"]);
    for (const item of list(detail["skills"])) fields(item, ["name", "type", "description", "iconUrl"], ["level"]);
    for (const item of list(detail["chains"])) {
      if (typeof fields(item, ["name", "description"], ["order"])["unlocked"] !== "boolean") throw new Error("本地共鸣链状态无效");
    }
    if (detail["weapon"] !== null) fields(detail["weapon"], ["name", "iconUrl", "effectName", "effectDescription"], ["level", "breach", "resonLevel", "starLevel"]);
    for (const item of list(detail["phantoms"])) {
      const phantom = fields(item, ["name", "iconUrl", "skillDescription"], ["level", "quality", "cost"]);
      for (const key of ["mainProps", "subProps"]) for (const prop of list(phantom[key])) fields(prop, ["name", "value"]);
    }
  }
  return value as RoleSnapshot;
}

export class RoleCacheStore {
  #queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path = join(appPaths.dataDirectory, "kujiequ-role-cache.json")) {}
  async #read(): Promise<Record<string, unknown>> {
    try {
      return object(JSON.parse(await readFile(this.path, "utf8")) as unknown);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
      throw new Error("读取本地角色缓存失败");
    }
  }
  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation);
    this.#queue = result.catch(() => {});
    return result;
  }
  read(key: string): Promise<RoleSnapshot | null> {
    return this.#serialize(async () => {
      const value = (await this.#read())[key];
      return value === undefined ? null : snapshot(value);
    });
  }
  #update(key: string, update: (previous: RoleSnapshot | null) => RoleSnapshot): Promise<void> {
    return this.#serialize(async () => {
      const stored = await this.#read();
      stored[key] = update(stored[key] === undefined ? null : snapshot(stored[key]));
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${crypto.randomUUID()}.tmp`;
      try {
        await Bun.write(temporary, `${JSON.stringify(stored, null, 2)}\n`);
        await rename(temporary, this.path);
      } finally {
        await rm(temporary, { force: true });
      }
    });
  }
  saveList(key: string, value: SavedRoleList): Promise<void> {
    return this.#update(key, (previous) =>
      previous && previous.updatedAt > value.updatedAt
        ? previous
        : {
            ...value,
            details: Object.fromEntries(Object.entries(previous?.details ?? {}).filter(([id]) => value.roles.some((role) => role.roleId === id))),
          },
    );
  }
  saveDetail(key: string, value: SavedRoleDetail): Promise<void> {
    return this.#update(key, (previous) => {
      if (!previous || !previous.roles.some((role) => role.roleId === value.detail.roleId)) throw new Error("请先查询角色列表");
      if ((previous.details[value.detail.roleId]?.updatedAt ?? -1) <= value.updatedAt) previous.details[value.detail.roleId] = value;
      return previous;
    });
  }
}
