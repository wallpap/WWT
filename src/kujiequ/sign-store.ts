import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { appPaths } from "../platform/app-paths.ts";
import { object, serverId } from "./model.ts";

export interface SignRecord {
  orderCode: string;
  date: string;
  name: string;
  count: string;
  iconUrl?: string;
}
export interface LegacySign {
  roleId: string;
  record: SignRecord;
}
export function legacySignKey(roleId: string): string {
  return JSON.stringify(["legacy-java", roleId, serverId]);
}
function readRecords(value: unknown): SignRecord[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "object" && item !== null && ["orderCode", "date", "name", "count"].every((field) => typeof object(item)[field] === "string"))) throw new Error("本地签到历史格式无效");
  return value as SignRecord[];
}
export function combineSignRecords(...groups: SignRecord[][]): SignRecord[] {
  const records = new Map<string, SignRecord>();
  for (const record of groups.flat()) {
    const key = record.orderCode || JSON.stringify([record.date, record.name, record.count]);
    records.set(key, { ...records.get(key), ...record });
  }
  return [...records.values()].sort((a, b) => b.date.localeCompare(a.date));
}
export class SignHistoryStore {
  #queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path = join(appPaths.dataDirectory, "kujiequ-sign-history.json")) {}
  async #read(): Promise<Record<string, unknown>> {
    try {
      return object(JSON.parse(await readFile(this.path, "utf8")) as unknown);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
      throw new Error("读取签到历史失败");
    }
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
  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation);
    this.#queue = result.catch(() => {});
    return result;
  }
  list(key: string): Promise<SignRecord[]> {
    return this.#serialize(async () => readRecords((await this.#read())[key] ?? []));
  }
  importLegacy(incoming: readonly LegacySign[]): Promise<{ addedCount: number; duplicateCount: number }> {
    return this.#serialize(async () => {
      const stored = await this.#read();
      let addedCount = 0;
      for (const { roleId, record } of incoming) {
        if (!/^\d+$/.test(roleId)) throw new Error("旧版签到玩家 ID 无效");
        readRecords([record]);
        const key = legacySignKey(roleId);
        const previous = readRecords(stored[key] ?? []);
        // 重复迁移保留已导入的数据，联网查询的结果在展示时优先。
        const merged = combineSignRecords([record], previous);
        addedCount += merged.length - previous.length;
        stored[key] = merged;
      }
      if (addedCount) await this.#write(stored);
      return { addedCount, duplicateCount: incoming.length - addedCount };
    });
  }
  merge(key: string, incoming: SignRecord[]): Promise<SignRecord[]> {
    return this.#serialize(async () => {
      const stored = await this.#read();
      const merged = combineSignRecords(readRecords(stored[key] ?? []), incoming);
      stored[key] = merged;
      await this.#write(stored);
      return merged;
    });
  }
}
export const signHistoryStore = new SignHistoryStore();
