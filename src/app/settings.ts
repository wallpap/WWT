import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { appPaths } from "../platform/app-paths.ts";
import { validateDownloadPolicy } from "../game/download-policy.ts";
import type { OfficialResourceSource } from "../game/official-resources.ts";
import { parseShortcut } from "./shortcut.ts";
import { normalizeUpdateSource } from "./update-release.ts";

const defaultDownloadParallel = 4;
const defaultWindowWidth = 1180;
const minimumWindowWidth = 640;
const maximumWindowWidth = 3840;
const defaultWindowHeight = 820;
const minimumWindowHeight = 480;
const maximumWindowHeight = 2160;
const defaultUiScale = 100;
const minimumUiScale = 75;
const maximumUiScale = 150;

export interface AppSettings {
  downloadSource: OfficialResourceSource;
  downloadParallel: number;
  downloadBytesPerSecond: number;
  startPage: "launcher" | "gacha" | "daily";
  windowWidth: number;
  windowHeight: number;
  uiScale: number;
  theme: "system" | "light" | "dark";
  closeAction: "exit" | "tray";
  hideOnGameStart: boolean;
  exitOnGameEnd: boolean;
  autoStartGame: boolean;
  silentStart: boolean;
  showShortcut: string;
  checkAppUpdates: boolean;
  startWithWindows: boolean;
  appUpdateSource: string;
  autoSign: boolean;
}
export const defaultAppSettings: Readonly<AppSettings> = {
  downloadSource: "mainland",
  downloadParallel: defaultDownloadParallel,
  downloadBytesPerSecond: 0,
  startPage: "launcher",
  windowWidth: defaultWindowWidth,
  windowHeight: defaultWindowHeight,
  uiScale: defaultUiScale,
  theme: "system",
  closeAction: "exit",
  hideOnGameStart: false,
  exitOnGameEnd: false,
  autoStartGame: false,
  silentStart: false,
  showShortcut: "",
  checkAppUpdates: false,
  startWithWindows: false,
  appUpdateSource: "",
  autoSign: false,
};
export function parseAppSettings(value: unknown): AppSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("应用设置格式无效");
  const row = value as Record<string, unknown>;
  const source = row["downloadSource"] ?? defaultAppSettings.downloadSource;
  if (!["mainland", "bilibili"].includes(String(source))) throw new Error("游戏渠道无效");
  const parallel = row["downloadParallel"] ?? defaultAppSettings.downloadParallel;
  const speed = row["downloadBytesPerSecond"] ?? defaultAppSettings.downloadBytesPerSecond;
  if (typeof parallel !== "number" || typeof speed !== "number") throw new Error("下载设置格式无效");
  validateDownloadPolicy({ parallel, bytesPerSecond: speed });
  const choice = <T extends string>(key: string, values: readonly T[], fallback: T): T => {
    const value = row[key] ?? fallback;
    if (typeof value !== "string" || !values.includes(value as T)) throw new Error(`应用设置 ${key} 无效`);
    return value as T;
  };
  const integer = (key: string, min: number, max: number, fallback: number): number => {
    const value = row[key] ?? fallback;
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error(`应用设置 ${key} 需在 ${min}—${max} 范围内`);
    return value;
  };
  const boolean = (key: keyof AppSettings): boolean => {
    const value = row[key] ?? defaultAppSettings[key];
    if (typeof value !== "boolean") throw new Error(`应用设置 ${key} 无效`);
    return value;
  };
  const shortcut = row["showShortcut"] ?? "";
  if (typeof shortcut !== "string") throw new Error("快捷键设置无效");
  const updateSource = row["appUpdateSource"] ?? "";
  if (typeof updateSource !== "string") throw new Error("应用更新源无效");
  return {
    downloadSource: source as OfficialResourceSource,
    downloadParallel: parallel,
    downloadBytesPerSecond: speed,
    startPage: choice("startPage", ["launcher", "gacha", "daily"], "launcher"),
    windowWidth: integer("windowWidth", minimumWindowWidth, maximumWindowWidth, defaultWindowWidth),
    windowHeight: integer("windowHeight", minimumWindowHeight, maximumWindowHeight, defaultWindowHeight),
    uiScale: integer("uiScale", minimumUiScale, maximumUiScale, defaultUiScale),
    theme: choice("theme", ["system", "light", "dark"], "system"),
    closeAction: choice("closeAction", ["exit", "tray"], "exit"),
    hideOnGameStart: boolean("hideOnGameStart"),
    exitOnGameEnd: boolean("exitOnGameEnd"),
    autoStartGame: boolean("autoStartGame"),
    silentStart: boolean("silentStart"),
    showShortcut: parseShortcut(shortcut)?.text ?? "",
    checkAppUpdates: boolean("checkAppUpdates"),
    startWithWindows: boolean("startWithWindows"),
    appUpdateSource: normalizeUpdateSource(updateSource),
    autoSign: boolean("autoSign"),
  };
}

export class AppSettingsStore {
  #queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path = join(appPaths.dataDirectory, "app-settings.json")) {}
  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation);
    this.#queue = result.catch(() => {});
    return result;
  }
  async #raw(): Promise<Record<string, unknown>> {
    try {
      const value: unknown = JSON.parse(await readFile(this.path, "utf8"));
      parseAppSettings(value);
      return value as Record<string, unknown>;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
      throw error;
    }
  }
  async #read(): Promise<AppSettings> {
    return parseAppSettings(await this.#raw());
  }
  async #writeExplicit(stored: Record<string, unknown>, settings: AppSettings): Promise<void> {
    const explicit = Object.fromEntries(
      Object.keys(stored)
        .filter((key) => Object.hasOwn(defaultAppSettings, key))
        .map((key) => [key, settings[key as keyof AppSettings]]),
    );
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${crypto.randomUUID()}.tmp`;
    try {
      await Bun.write(temporary, `${JSON.stringify(explicit, null, 2)}\n`);
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  read(): Promise<AppSettings> {
    return this.#serialize(() => this.#read());
  }
  update(patch: Partial<AppSettings>): Promise<AppSettings> {
    return this.#serialize(async () => {
      const stored = { ...(await this.#raw()), ...patch };
      const settings = parseAppSettings(stored);
      await this.#writeExplicit(stored, settings);
      return settings;
    });
  }
  importMissing(patch: Partial<AppSettings>): Promise<{ addedCount: number; duplicateCount: number }> {
    return this.#serialize(async () => {
      const stored = await this.#raw();
      const entries = Object.entries(patch).filter(([key, value]) => Object.hasOwn(defaultAppSettings, key) && value !== undefined);
      const missing = entries.filter(([key]) => !Object.hasOwn(stored, key));
      const settings = parseAppSettings({
        ...stored,
        ...Object.fromEntries(missing),
      });
      if (missing.length) {
        await this.#writeExplicit({ ...stored, ...Object.fromEntries(missing) }, settings);
      }
      return {
        addedCount: missing.length,
        duplicateCount: entries.length - missing.length,
      };
    });
  }
}
export const appSettings = new AppSettingsStore();
