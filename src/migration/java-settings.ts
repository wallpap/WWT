import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { object } from "../kujiequ/model.ts";
import { parseAppSettings } from "../app/settings.ts";
import type { LegacySettings } from "./settings.ts";

const legacyCloseEvent = { systemDefault: 0, exit: 1, minimizeToTray: 2 } as const;
const legacyCloseEventCodes: ReadonlySet<number> = new Set(Object.values(legacyCloseEvent));

export async function readJavaSettings(path: string): Promise<LegacySettings> {
  let row: Record<string, unknown>;
  try {
    row = object(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch {
    throw new Error("原版设置文件格式无效");
  }
  const result: LegacySettings = { app: {}, game: {} };
  const sources = {
    DEFAULT: "mainland",
    WE_GAME: "mainland",
    BILIBILI: "bilibili",
  } as const;
  let source = row["gameRootDirSource"],
    directory = row["gameRootDir"],
    executable = row["gameStarAppPath"];
  if (row["gameInstallations"] != null) {
    if (!Array.isArray(row["gameInstallations"])) throw new Error("原版游戏安装列表格式无效");
    const installations = row["gameInstallations"].map(object);
    if (installations.length) {
      const id = row["activeGameInstallationId"] ?? "china";
      const selected = installations.find((item) => item["id"] === id);
      if (!selected) throw new Error("原版活动游戏安装不存在");
      source = selected["source"];
      directory = selected["gameDir"];
      executable = selected["startAppPath"];
    }
  }
  if (source != null) {
    if (typeof source !== "string" || !Object.hasOwn(sources, source)) throw new Error("原版游戏渠道无效");
    result.app.downloadSource = sources[source as keyof typeof sources];
  }
  if (row["downloadParallelCount"] != null) result.app.downloadParallel = row["downloadParallelCount"] as number;
  if (row["downloadSpeedLimitBytesPerSecond"] != null) result.app.downloadBytesPerSecond = row["downloadSpeedLimitBytesPerSecond"] as number;
  for (const [source, target] of [
    ["exitWhenGameOver", "exitOnGameEnd"],
    ["hideWhenGameStart", "hideOnGameStart"],
    ["autoStartGame", "autoStartGame"],
    ["silentStart", "silentStart"],
    ["checkNewVersion", "checkAppUpdates"],
    ["autoKujieQuSign", "autoSign"],
  ] as const) {
    if (row[source] != null) {
      if (typeof row[source] !== "boolean") throw new Error(`原版设置 ${source} 无效`);
      result.app[target] = row[source];
    }
  }
  if (row["firstViewWithPoolAnalysis"] != null) {
    if (typeof row["firstViewWithPoolAnalysis"] !== "boolean") throw new Error("原版启动页面无效");
    result.app.startPage = row["firstViewWithPoolAnalysis"] ? "gacha" : "launcher";
  }
  for (const [source, target] of [
    ["appWidth", "windowWidth"],
    ["appHeight", "windowHeight"],
    ["uiScale", "uiScale"],
  ] as const) {
    if (row[source] != null) {
      if (typeof row[source] !== "number" || !Number.isFinite(row[source])) throw new Error(`原版设置 ${source} 无效`);
      result.app[target] = Math.round(row[source]);
    }
  }
  if (row["closeEvent"] != null) {
    if (!legacyCloseEventCodes.has(row["closeEvent"] as number)) throw new Error("原版关闭行为无效");
    if (row["closeEvent"] !== legacyCloseEvent.systemDefault) result.app.closeAction = row["closeEvent"] === legacyCloseEvent.minimizeToTray ? "tray" : "exit";
  }
  parseAppSettings(result.app);
  if (directory != null && typeof directory !== "string") throw new Error("原版游戏路径无效");
  if (executable != null && typeof executable !== "string") throw new Error("原版启动程序路径无效");
  const root = typeof directory === "string" ? directory.trim() : "";
  const target = typeof executable === "string" && executable.trim() ? executable.trim() : "Wuthering Waves.exe";
  if (isAbsolute(target)) result.game.executablePath = target;
  else if (root) result.game.executablePath = join(root, target);
  if (result.game.executablePath && !/\.exe$/i.test(result.game.executablePath)) throw new Error("原版启动程序必须是 EXE 文件");
  return result;
}
