import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMigrationSource } from "../../src/migration/read.ts";

test("Java settings migrate supported fields from legacy paths and the selected installation", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-java-settings-")),
    path = join(root, "settings.json");
  try {
    await writeFile(
      path,
      JSON.stringify({
        gameRootDir: "C:\\Game",
        gameStarAppPath: "Wuthering Waves.exe",
        gameRootDirSource: "BILIBILI",
        downloadParallelCount: 6,
        downloadSpeedLimitBytesPerSecond: 1048576,
        serverPassword: "fixture-secret",
        appParams: "cancelled",
        userAdvanceGameSettings: true,
      }),
    );
    const before = await readFile(path);
    const records = await readMigrationSource("java-settings", path);
    expect(records.settings).toEqual({
      app: {
        downloadSource: "bilibili",
        downloadParallel: 6,
        downloadBytesPerSecond: 1048576,
      },
      game: { executablePath: join("C:\\Game", "Wuthering Waves.exe") },
    });
    expect(JSON.stringify(records)).not.toContain("fixture-secret");
    expect(JSON.stringify(records)).not.toContain("cancelled");
    expect(await readFile(path)).toEqual(before);
    await writeFile(
      path,
      JSON.stringify({
        gameRootDir: "C:\\OldGame",
        gameRootDirSource: "DEFAULT",
        activeGameInstallationId: "bilibili",
        gameInstallations: [
          { id: "china", gameDir: "C:\\China", source: "DEFAULT" },
          {
            id: "bilibili",
            gameDir: "D:\\Bilibili",
            source: "BILIBILI",
            startAppPath: "Custom.exe",
          },
        ],
      }),
    );
    expect((await readMigrationSource("java-settings", path)).settings).toEqual({
      app: { downloadSource: "bilibili" },
      game: { executablePath: join("D:\\Bilibili", "Custom.exe") },
    });
    await writeFile(
      path,
      JSON.stringify({
        firstViewWithPoolAnalysis: true,
        exitWhenGameOver: true,
        hideWhenGameStart: true,
        autoStartGame: false,
        silentStart: true,
        closeEvent: 2,
        uiScale: 110,
        appWidth: 1280,
        appHeight: 760,
        autoStart: true,
      }),
    );
    expect((await readMigrationSource("java-settings", path)).settings!.app).toEqual({
      startPage: "gacha",
      exitOnGameEnd: true,
      hideOnGameStart: true,
      autoStartGame: false,
      silentStart: true,
      closeAction: "tray",
      uiScale: 110,
      windowWidth: 1280,
      windowHeight: 760,
    });
    await writeFile(path, JSON.stringify({ autoKujieQuSign: true }));
    expect((await readMigrationSource("java-settings", path)).settings!.app).toEqual({ autoSign: true });
    await writeFile(path, JSON.stringify({ downloadParallelCount: 0 }));
    await expect(readMigrationSource("java-settings", path)).rejects.toThrow("1—16");
    await writeFile(path, '{"fixture-secret": invalid');
    await expect(readMigrationSource("java-settings", path)).rejects.toThrow(/^原版设置文件格式无效$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
