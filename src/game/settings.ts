import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { appPaths } from "../platform/app-paths.ts";
import type { GameSettings } from "./model.ts";

const defaultSettings: GameSettings = {
  executablePath: "",
  resourceTier: "auto",
};

function isGameSettings(value: unknown): value is GameSettings {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record["executablePath"] === "string" && (record["resourceTier"] === undefined || ["auto", "uhd", "hd", "sd"].includes(String(record["resourceTier"])));
}

export class GameSettingsStore {
  #queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path = appPaths.settings) {}
  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation);
    this.#queue = result.catch(() => {});
    return result;
  }
  async #read(): Promise<GameSettings> {
    try {
      const value: unknown = JSON.parse(await readFile(this.path, "utf8"));
      if (!isGameSettings(value)) return { ...defaultSettings };
      return {
        executablePath: value.executablePath,
        resourceTier: value.resourceTier ?? "auto",
      };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return { ...defaultSettings };
      throw error;
    }
  }
  read(): Promise<GameSettings> {
    return this.#serialize(() => this.#read());
  }

  async #write(settings: GameSettings): Promise<void> {
    if (!isGameSettings(settings)) throw new Error("游戏设置格式无效");
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
    try {
      await Bun.write(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`);
      await rename(temporaryPath, this.path);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
  write(settings: GameSettings): Promise<void> {
    return this.#serialize(() => this.#write(settings));
  }
  importMissing(patch: Partial<GameSettings>): Promise<{ addedCount: number; duplicateCount: number }> {
    return this.#serialize(async () => {
      let stored: Record<string, unknown> = {};
      try {
        const value = JSON.parse(await readFile(this.path, "utf8")) as unknown;
        if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("游戏设置格式无效");
        stored = value as Record<string, unknown>;
        if (!isGameSettings(stored)) throw new Error("游戏设置格式无效");
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      const entries = Object.entries(patch).filter(([key, value]) => Object.hasOwn(defaultSettings, key) && value !== undefined);
      const missing = entries.filter(([key]) => !Object.hasOwn(stored, key));
      const settings = {
        ...defaultSettings,
        ...stored,
        ...Object.fromEntries(missing),
      };
      if (!isGameSettings(settings)) throw new Error("旧版游戏设置格式无效");
      if (missing.length) await this.#write(settings);
      return {
        addedCount: missing.length,
        duplicateCount: entries.length - missing.length,
      };
    });
  }
}
export const gameSettings = new GameSettingsStore();
export const readGameSettings = () => gameSettings.read();
export const writeGameSettings = (settings: GameSettings) => gameSettings.write(settings);
