import { dirname, join, resolve } from "node:path";

export interface AppPathOptions {
  standalone: boolean;
  executablePath: string;
  projectDirectory: string;
}

export interface AppPaths {
  rootDirectory: string;
  dataDirectory: string;
  gachaRecords: string;
  exportDirectory: string;
  settings: string;
  gameTimeRecords: string;
}

export function resolveAppPaths(options: AppPathOptions): AppPaths {
  const rootDirectory = options.standalone ? dirname(options.executablePath) : resolve(options.projectDirectory);
  const dataDirectory = join(rootDirectory, options.standalone ? "data" : "user-data");

  return {
    rootDirectory,
    dataDirectory,
    gachaRecords: join(dataDirectory, "gacha-records.json"),
    exportDirectory: join(dataDirectory, "exports"),
    settings: join(dataDirectory, "settings.json"),
    gameTimeRecords: join(dataDirectory, "game-time.json"),
  };
}

export const appPaths = resolveAppPaths({
  standalone: Bun.isStandaloneExecutable,
  executablePath: process.execPath,
  projectDirectory: resolve(import.meta.dir, "../.."),
});
