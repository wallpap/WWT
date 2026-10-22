import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { appPaths } from "../platform/app-paths.ts";
import { emptyArchive, parseArchive, type LocalArchive } from "./model.ts";
import { combineBattleObservations, parseBattleLogEvents, summarizeBattleEvents, type BattleLogEvent } from "./battle-log.ts";

interface StoredArchive extends LocalArchive {
  battleLogEvents?: BattleLogEvent[];
}

export class LocalArchiveStore {
  #queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path = join(appPaths.dataDirectory, "local-archive.json")) {}
  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation);
    this.#queue = result.catch(() => {});
    return result;
  }
  async #read(): Promise<StoredArchive> {
    try {
      const value: unknown = JSON.parse(await readFile(this.path, "utf8"));
      const archive = parseArchive(value);
      const events = typeof value === "object" && value !== null && "battleLogEvents" in value ? parseBattleLogEvents(value.battleLogEvents) : [];
      return { ...archive, battleLogEvents: events };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return emptyArchive();
      throw new Error("读取本地档案失败");
    }
  }
  async #write(archive: StoredArchive): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${crypto.randomUUID()}.tmp`;
    try {
      await Bun.write(temporary, `${JSON.stringify(archive, null, 2)}\n`);
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  read(): Promise<LocalArchive> {
    return this.#serialize(async () => {
      const stored = await this.#read();
      return {
        battles: combineBattleObservations(stored.battles, summarizeBattleEvents(stored.battleLogEvents ?? [])),
        players: stored.players,
        roles: stored.roles,
      };
    });
  }
  mergeLogEvents(incoming: readonly BattleLogEvent[]): Promise<{ addedCount: number; duplicateCount: number }> {
    return this.#serialize(async () => {
      const validated = parseBattleLogEvents(incoming);
      const stored = await this.#read();
      const events = new Map((stored.battleLogEvents ?? []).map((event) => [event.id, event]));
      const previous = events.size;
      for (const event of validated) if (!events.has(event.id)) events.set(event.id, event);
      const addedCount = events.size - previous;
      if (addedCount) await this.#write({ ...stored, battleLogEvents: [...events.values()] });
      return { addedCount, duplicateCount: validated.length - addedCount };
    });
  }
  importLegacy(incoming: LocalArchive): Promise<{ addedCount: number; duplicateCount: number }> {
    return this.#serialize(async () => {
      const validated = parseArchive(incoming),
        stored = await this.#read();
      const battles = new Map(stored.battles.map((row) => [JSON.stringify([row.roleId, row.date]), row]));
      const players = new Map(stored.players.map((row) => [row.roleId, row]));
      const roles = new Map(stored.roles.map((row) => [row.roleId, row]));
      let addedCount = 0;
      for (const row of validated.battles) {
        const key = JSON.stringify([row.roleId, row.date]);
        if (!battles.has(key)) {
          battles.set(key, row);
          addedCount++;
        }
      }
      for (const row of validated.players) {
        const previous = players.get(row.roleId);
        if (!previous || previous.updatedAt < row.updatedAt) {
          players.set(row.roleId, row);
          addedCount++;
        }
      }
      for (const row of validated.roles)
        if (!roles.has(row.roleId)) {
          roles.set(row.roleId, row);
          addedCount++;
        }
      if (addedCount) {
        const archive: StoredArchive = {
          battles: [...battles.values()].sort((a, b) => b.date.localeCompare(a.date)),
          players: [...players.values()],
          roles: [...roles.values()],
          battleLogEvents: stored.battleLogEvents ?? [],
        };
        await this.#write(archive);
      }
      return {
        addedCount,
        duplicateCount: validated.battles.length + validated.players.length + validated.roles.length - addedCount,
      };
    });
  }
}
export const localArchiveStore = new LocalArchiveStore();
