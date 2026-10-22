import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import type { GameLaunchPlan, GameResourceStatus, ResourceTier } from "./model.ts";
import { GameProcessTracker, type TrackedGameSession } from "./process-tracker.ts";

const tiers: readonly ResourceTier[] = ["uhd", "hd", "sd"];
const names: Record<ResourceTier, string> = { uhd: "UHD", hd: "HD", sd: "SD" };

export function validateGameExecutable(executablePath: string): string {
  const normalizedPath = executablePath.trim();
  if (!normalizedPath) throw new Error("请先填写游戏可执行文件路径");
  if (extname(normalizedPath).toLowerCase() !== ".exe") {
    throw new Error("游戏路径必须指向 .exe 文件");
  }
  if (!existsSync(normalizedPath) || !statSync(normalizedPath).isFile()) {
    throw new Error("游戏可执行文件不存在");
  }
  return normalizedPath;
}

export function detectResourceTiers(executablePath: string): ResourceTier[] {
  const root = dirname(validateGameExecutable(executablePath));
  return tiers.filter((tier) => {
    const directory = join(root, "Client", "Content", names[tier]);
    if (!existsSync(directory) || !statSync(directory).isDirectory()) return false;
    return readdirSync(directory, { withFileTypes: true }).some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pak") && statSync(join(directory, entry.name)).size > 0);
  });
}

export function inspectGameResources(executablePath: string): GameResourceStatus {
  const path = validateGameExecutable(executablePath);
  const availableTiers = detectResourceTiers(path);
  return {
    executablePath: path,
    workingDirectory: dirname(path),
    availableTiers,
    missingTiers: tiers.filter((tier) => !availableTiers.includes(tier)),
  };
}

export function prepareGameLaunch(executablePath: string, requested: ResourceTier | "auto"): GameLaunchPlan {
  const path = validateGameExecutable(executablePath);
  const availableTiers = detectResourceTiers(path);
  const selected = requested === "auto" ? ["hd", "uhd", "sd"].find((tier) => availableTiers.includes(tier as ResourceTier)) : requested;
  if (!selected || !availableTiers.includes(selected as ResourceTier)) throw new Error("未检测到所选资源档位，请先使用官方启动器下载资源");
  return {
    executablePath: path,
    workingDirectory: dirname(path),
    resourceTier: selected as ResourceTier,
    arguments: [`-krqlv=${selected}`],
    availableTiers,
  };
}

const gameProcessTracker = new GameProcessTracker((plan) =>
  Bun.spawn([plan.executablePath, ...plan.arguments], {
    cwd: plan.workingDirectory,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    detached: true,
  }),
);

export function launchGame(plan: GameLaunchPlan): void {
  gameProcessTracker.launch(plan);
}

export function isLaunchedGameRunning(): boolean {
  return gameProcessTracker.isRunning;
}

export function onLaunchedGameExit(listener: (session: TrackedGameSession) => void | Promise<void>): () => void {
  return gameProcessTracker.onExit(listener);
}
