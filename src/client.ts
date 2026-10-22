import { acquireProcessLock } from "./platform/process-lock.ts";
import { diagnostic } from "./platform/diagnostics.ts";
import html from "./index.html" with { type: "text" };
import styles from "./style.css" with { type: "text" };
import renderer from "../.build/renderer.js" with { type: "text" };
import { assembleUi } from "./ui-document.ts";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { appPaths } from "./platform/app-paths.ts";
import { importGachaRecords, queryGachaRecords } from "./gacha/service.ts";
import { readGachaRecords } from "./gacha/store.ts";
import { summarizeGacha } from "./gacha/stats.ts";
import type { GachaRecord } from "./gacha/model.ts";
import { NativeWebview } from "./platform/native-webview.ts";
import { showStartupError } from "./platform/windows-dialog.ts";
import { ensureWebView2Runtime } from "./platform/webview-runtime.ts";
import { inspectGameResources, launchGame, onLaunchedGameExit, prepareGameLaunch, validateGameExecutable } from "./game/launcher.ts";
import { LaunchWorkflow } from "./game/launch-workflow.ts";
import { readGameSettings, writeGameSettings } from "./game/settings.ts";
import { addGameTimeRecord, addGameTimeRecords, deleteGameTimeRecord, readGameTimeRecords } from "./game-time/store.ts";
import { summarizeGameTime } from "./game-time/stats.ts";
import type { GameTimeRecord } from "./game-time/model.ts";
import { importGameTimeLogs } from "./game-time/log-import.ts";
import { splitGameSession } from "./game-time/session.ts";
import { inspectLocalInstallation } from "./game/local-manifest.ts";
import { checkLocalResources } from "./game/resource-check.ts";
import { fetchOfficialResourceManifest } from "./game/official-resources.ts";
import { planResourceUpdate, planInstalledResourceUpdate, planGameResourceUpdate } from "./game/resource-plan.ts";
import { ResourceUpdateWorkflow } from "./game/resource-update-workflow.ts";
import { installResourceManifest } from "./game/resource-installation.ts";
import type { OfficialResourceManifest } from "./game/official-resources.ts";
import { isLaunchedGameRunning } from "./game/launcher.ts";
import { pickGameExecutable, pickGameInstallDirectory, pickGachaLogFile, pickMigrationSource } from "./platform/game-file-picker.ts";
import { extractGachaLinkFromLog } from "./gacha/log.ts";
import { encodeGachaXlsx, parseGachaXlsx } from "./gacha/xlsx.ts";
import { AccountService } from "./kujiequ/accounts.ts";
import { bindKuroAccounts } from "./kujiequ/bindings.ts";
import { cancelKuroCaptcha } from "./kujiequ/captcha.ts";
import { MigrationService } from "./migration/service.ts";
import type { MigrationKind } from "./migration/service.ts";
import type { MigrationSource } from "./migration/read.ts";
import { recoverResourceTransactions } from "./game/resource-transaction.ts";
import { appSettings } from "./app/settings.ts";
import { millisecondsPerMinute } from "./units.ts";
import { predownloadResources } from "./game/resource-predownload.ts";
import { localArchiveStore } from "./local-data/store.ts";
import { ServerSwitchService, type SwitchSource } from "./game/server-switch.ts";
import type { ServerOperation } from "./game/server-switch-controls.ts";
import { isGameProcessRunning } from "./game/running-process.ts";
import { importBattleLogs } from "./local-data/battle-log-import.ts";
import { RedemptionCodeService } from "./app/redemption-codes.ts";
import { copyText } from "./platform/clipboard.ts";
import { openWithSystem } from "./platform/shell.ts";
import { gameLinkUrl, type GameLink } from "./game/links.ts";
import { listGameScreenshots, readGameScreenshot, gameScreenshotPath, screenshotDirectory } from "./game/screenshots.ts";
import { DesktopWindow } from "./platform/desktop-window.ts";
import { setWindowsStartup } from "./platform/startup.ts";
import { PreferenceService } from "./app/preference-service.ts";
import { AppUpdateService } from "./app/updater.ts";
import { SignService } from "./kujiequ/sign.ts";
import { AutoSignService } from "./kujiequ/auto-sign.ts";
import { GameImageCache } from "./kujiequ/image-cache.ts";

const shutdownPollIntervalMs = 30;
const resourceProgressThrottleMs = 150;

function resolveBrandAvatarPath(): string {
  const path = Bun.isStandaloneExecutable
    ? join(dirname(process.execPath), "carlotta.png")
    : join(import.meta.dir, "assets/carlotta.png");
  if (!existsSync(path)) throw new Error(`缺少珂莱塔头像资源：${path}`);
  return path;
}

function exportFileName(format: "json" | "xlsx"): string {
  return `gacha-records-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.${format}`;
}

function decodeBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

async function recoverGameInstallation(executablePath: string): Promise<void> {
  if (executablePath.trim() && extname(executablePath.trim()).toLowerCase() === ".exe") await recoverResourceTransactions(dirname(resolve(executablePath.trim())));
}

async function startClient(): Promise<void> {
  let preferences = await appSettings.read();
  const webview = new NativeWebview("鸣潮助手", preferences.windowWidth, preferences.windowHeight);
  const accounts = new AccountService();
  const images = new GameImageCache();
  webview.bind("loadGameImage", (url: string) => images.load(url));
  const signs = new SignService(accounts);
  const autoSign = new AutoSignService(
    signs,
    () => preferences.autoSign,
    (status) => {
      webview.evaluate(`window.dispatchEvent(new CustomEvent("auto-sign-changed", { detail: ${JSON.stringify(status)} }))`);
    },
  );
  const redemption = new RedemptionCodeService();
  const updater = new AppUpdateService();
  const migration = new MigrationService(undefined, undefined, undefined, undefined, undefined, { accounts: (records) => accounts.importLegacy(records) });
  const launchWorkflow = new LaunchWorkflow(prepareGameLaunch, launchGame);
  let officialManifest: OfficialResourceManifest | null = null;
  let plannedManifest: OfficialResourceManifest | null = null;
  let serverController: AbortController | null = null;
  const serverSwitch = new ServerSwitchService(fetchOfficialResourceManifest, async () => isLaunchedGameRunning() || (await isGameProcessRunning()));
  const resourceUpdateWorkflow = new ResourceUpdateWorkflow(async (root, files, options) => {
    if (updater.installing) throw new Error("应用更新安装器正在准备退出，请稍候");
    if (plannedManifest === null) throw new Error("请重新查询官方资源并生成计划");
    if (serverController) throw new Error("正在处理服务器文件，请等待完成");
    const settings = await appSettings.read();
    const policy = {
      ...options,
      parallel: settings.downloadParallel,
      bytesPerSecond: settings.downloadBytesPerSecond,
    };
    if (plannedManifest.predownload) return predownloadResources(root, files, plannedManifest, policy);
    if (isLaunchedGameRunning() || (await isGameProcessRunning())) throw new Error("游戏进程仍在运行，请先退出游戏后再安装资源");
    if (exiting || updater.installing) throw new Error("应用正在退出");
    return installResourceManifest(root, files, plannedManifest, {
      ...policy,
      beforeCommit: async () => {
        if ((await isGameProcessRunning()) || isLaunchedGameRunning()) throw new Error("游戏已启动，请退出后重新安装资源");
      },
    });
  });
  let exiting = false;
  async function requestExit(): Promise<void> {
    diagnostic("app.exit.requested", {
      resources: resourceUpdateWorkflow.isInstalling,
      server: serverController !== null,
      updater: updater.preparing,
      autoSign: autoSign.status().running,
    });
    if (exiting) return;
    exiting = true;
    resourceUpdateWorkflow.cancel();
    serverController?.abort(new Error("应用正在退出"));
    updater.cancel();
    autoSign.stop();
    accounts.api.cancel();
    images.cancel();
    cancelKuroCaptcha();
    while (resourceUpdateWorkflow.isInstalling || serverController !== null || updater.preparing || autoSign.status().running) await Bun.sleep(shutdownPollIntervalMs);
    diagnostic("app.exit.ready");
    webview.terminate();
  }
  let desktop: DesktopWindow;
  try {
    desktop = new DesktopWindow(
      webview.windowHandle,
      preferences,
      () => {
        void requestExit();
      },
      (message) => {
        webview.evaluate(`window.dispatchEvent(new CustomEvent("desktop-error", { detail: ${JSON.stringify(message)} }))`);
      },
    );
  } catch (error) {
    webview.destroy();
    throw error;
  }
  const preferenceService = new PreferenceService(appSettings, (next) => desktop.configure(next), setWindowsStartup);
  async function startGame(executablePath: string, resourceTier: "auto" | "uhd" | "hd" | "sd") {
    if (exiting || updater.installing) throw new Error("应用正在退出");
    if (serverController) throw new Error("正在处理服务器文件，请等待完成后启动游戏");
    if (resourceUpdateWorkflow.isInstalling && !plannedManifest?.predownload) throw new Error("正在安装资源，请等待完成后再启动游戏");
    await recoverGameInstallation(executablePath);
    if (exiting || updater.installing) throw new Error("应用正在退出");
    launchWorkflow.preview(executablePath, resourceTier);
    launchWorkflow.confirm(executablePath, resourceTier);
    const result = await launchWorkflow.launch(executablePath, resourceTier);
    if (preferences.hideOnGameStart && desktop.trayAvailable) desktop.hide();
    return result;
  }
  onLaunchedGameExit(async ({ startedAt, endedAt }) => {
    const duration = endedAt - startedAt;
    if (duration >= millisecondsPerMinute) {
      const additions = splitGameSession(null, startedAt, endedAt).map((record) => ({ ...record, source: "auto" as const }));
      try {
        await addGameTimeRecords(additions);
        webview.evaluate('window.dispatchEvent(new Event("game-time-changed"))');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        webview.evaluate(`window.dispatchEvent(new CustomEvent("game-time-error", { detail: ${JSON.stringify(message)} }))`);
      }
    }
    if (preferences.exitOnGameEnd) await requestExit();
  });
  let uiDirectory: string | null = null;
  try {
    bindKuroAccounts(webview, accounts, signs);
    webview.bind("loadAutoSignStatus", () => autoSign.status());
    webview.bind("loadRedemptionCodes", (force: boolean, localOnly?: boolean) => (localOnly ? redemption.local() : redemption.load(force)));
    webview.bind("copyText", copyText);
    webview.bind("openGameLink", (key: GameLink) => openWithSystem(gameLinkUrl(key)));
    webview.bind("listGameScreenshots", listGameScreenshots);
    webview.bind("readGameScreenshot", readGameScreenshot);
    webview.bind("openGameScreenshot", async (executable: string, path: string) => openWithSystem(await gameScreenshotPath(executable, path)));
    webview.bind("openScreenshotFolder", async (executable: string) => openWithSystem(await screenshotDirectory(executable)));
    webview.bind("loadAppSettings", () => appSettings.read());
    webview.bind("updateAppSettings", async (...args: Parameters<PreferenceService["update"]>) => {
      preferences = await preferenceService.update(...args);
      void autoSign.tick();
      return preferences;
    });
    webview.bind("desktopStatus", () => ({
      portable: Bun.isStandaloneExecutable,
      trayAvailable: desktop.trayAvailable,
      notice: desktop.notice,
    }));
    webview.bind("hideToTray", () => desktop.hide());
    webview.bind("appUpdateInfo", async () => ({
      version: updater.currentVersion,
      portable: Bun.isStandaloneExecutable,
      lastResult: await updater.lastResult(),
    }));
    webview.bind("checkAppUpdate", (source: string) => updater.check(source));
    webview.bind("prepareAppUpdate", (id: string) =>
      updater.prepare(id, (progress) => {
        webview.evaluate(`window.dispatchEvent(new CustomEvent("app-update-progress", { detail: ${JSON.stringify(progress)} }))`);
      }),
    );
    webview.bind("cancelAppUpdate", () => updater.cancel());
    webview.bind("installAppUpdate", async (id: string) => {
      if (resourceUpdateWorkflow.isInstalling || serverController || isLaunchedGameRunning()) throw new Error("请先完成游戏资源操作并结束本工具记录的游戏会话");
      await updater.install(id);
      await requestExit();
    });
    webview.bind("pickMigrationSource", pickMigrationSource);
    webview.bind("previewMigration", (source: MigrationSource, path: string, playerId: string) => migration.preview(source, path, playerId));
    webview.bind("importMigration", async (id: string, kind: MigrationKind) => {
      const result = await migration.import(id, kind);
      if (kind === "settings") {
        preferences = await appSettings.read();
        try {
          desktop.configure(preferences);
        } catch (error) {
          desktop.notice = error instanceof Error ? error.message : "部分桌面偏好未能应用";
        }
        void autoSign.tick();
      }
      return result;
    });
    webview.bind("loadLocalArchive", () => localArchiveStore.read());
    webview.bind("importBattleLogs", (executablePath: string) => importBattleLogs(executablePath));
    webview.bind("cancelServerOperation", () => {
      serverController?.abort(new Error("服务器文件操作已取消"));
    });
    webview.bind("runServerOperation", async (executablePath: string, action: ServerOperation, source: SwitchSource) => {
      if (resourceUpdateWorkflow.isInstalling || serverController || updater.installing) throw new Error("正在处理资源或应用更新，请等待完成");
      const root = dirname(resolve(validateGameExecutable(executablePath)));
      const controller = new AbortController();
      serverController = controller;
      try {
        const settings = await appSettings.read();
        const options = {
          signal: controller.signal,
          parallel: settings.downloadParallel,
          bytesPerSecond: settings.downloadBytesPerSecond,
          onProgress: (progress: import("./game/resource-update.ts").ResourceUpdateProgress) => {
            webview.evaluate(`window.dispatchEvent(new CustomEvent("server-switch-progress", { detail: ${JSON.stringify(progress)} }))`);
          },
        };
        let notice: string | undefined;
        if (action === "prepare") notice = (await serverSwitch.prepare(root, source, options)).notice;
        else if (action === "apply") {
          notice = (await serverSwitch.apply(root, source, options)).notice;
          try {
            await appSettings.update({ downloadSource: source });
          } catch {
            notice = [notice, "服务器已切换，下载渠道设置未能保存"].filter(Boolean).join("；");
          }
          webview.evaluate('window.dispatchEvent(new Event("app-settings-changed"))');
        } else if (action === "delete") await serverSwitch.deleteCache(root, source);
        else if (action !== "inspect") throw new Error("服务器文件操作类型无效");
        return {
          status: await serverSwitch.inspect(root),
          ...(notice ? { notice } : {}),
        };
      } finally {
        serverController = null;
      }
    });
    webview.bind("loadRecords", async () => ({
      records: await readGachaRecords(),
    }));
    webview.bind("queryGachaRecords", (link: string) =>
      queryGachaRecords(link, (progress) => {
        webview.evaluate(`window.dispatchEvent(new CustomEvent("gacha-query-progress", { detail: ${JSON.stringify(progress)} }))`);
      }),
    );
    webview.bind("importRecords", (payload: { format: "json" | "xlsx"; data: string }, playerId: string) => {
      if (payload.format === "xlsx") return importGachaRecords(JSON.stringify(parseGachaXlsx(decodeBase64(payload.data), playerId)));
      return importGachaRecords(payload.data, playerId || undefined);
    });
    webview.bind("summarizeRecords", (records: GachaRecord[]) => summarizeGacha(records));
    webview.bind("exportRecords", async (records: GachaRecord[], format: "json" | "xlsx") => {
      await mkdir(appPaths.exportDirectory, { recursive: true });
      const exportPath = join(appPaths.exportDirectory, exportFileName(format));
      const body = format === "xlsx" ? encodeGachaXlsx(records) : `${JSON.stringify(records, null, 2)}\n`;
      await writeFile(exportPath, body, { flag: "wx" });
      return { path: exportPath };
    });
    webview.bind("loadGameSettings", readGameSettings);
    webview.bind("pickGameExecutable", pickGameExecutable);
    webview.bind("pickGameInstallDirectory", pickGameInstallDirectory);
    webview.bind("pickGachaLogFile", pickGachaLogFile);
    webview.bind("extractGachaLinkFromLog", extractGachaLinkFromLog);
    webview.bind("loadGameTime", readGameTimeRecords);
    webview.bind("summarizeGameTime", (records: GameTimeRecord[], today: string) => summarizeGameTime(records, today));
    webview.bind("addGameTime", (record: Omit<GameTimeRecord, "id">) => addGameTimeRecord(record));
    webview.bind("deleteGameTime", (id: number) => deleteGameTimeRecord(id));
    webview.bind("importGameTimeLogs", importGameTimeLogs);
    webview.bind("saveGameSettings", async (executablePath: string, resourceTier: "auto" | "uhd" | "hd" | "sd") => {
      const settings = {
        executablePath: executablePath.trim(),
        resourceTier,
      };
      await writeGameSettings(settings);
      return settings;
    });
    webview.bind("inspectGame", (executablePath: string, resourceTier: "auto" | "uhd" | "hd" | "sd") => prepareGameLaunch(executablePath, resourceTier));
    webview.bind("previewGameLaunch", (path: string, tier: "auto" | "uhd" | "hd" | "sd") => launchWorkflow.preview(path, tier));
    webview.bind("confirmGameLaunch", (path: string, tier: "auto" | "uhd" | "hd" | "sd") => launchWorkflow.confirm(path, tier));
    webview.bind("inspectResources", async (path: string) => {
      await recoverGameInstallation(path);
      return inspectGameResources(path);
    });
    webview.bind("inspectLocalInstallation", async (path: string) => {
      await recoverGameInstallation(path);
      return inspectLocalInstallation(path);
    });
    webview.bind("checkLocalResources", checkLocalResources);
    webview.bind("fetchOfficialResources", async (source: Parameters<typeof fetchOfficialResourceManifest>[0], predownload: boolean = false, fromVersion?: string | null) => {
      const manifest = await fetchOfficialResourceManifest(source, predownload, fetch, fromVersion);
      officialManifest = manifest;
      return manifest;
    });
    webview.bind("planResourceUpdate", async (local: Parameters<typeof planResourceUpdate>[0], official: Parameters<typeof planResourceUpdate>[1], root: string, repair = false) => {
      return repair ? planInstalledResourceUpdate(root, local, official) : planGameResourceUpdate(root, local, official, officialManifest?.patch);
    });
    webview.bind("previewResourceUpdate", (root: string, files: Parameters<typeof resourceUpdateWorkflow.preview>[1]) => {
      const count = resourceUpdateWorkflow.preview(root, files);
      plannedManifest = officialManifest;
      return count;
    });
    webview.bind("confirmResourceUpdate", (root: string, files: Parameters<typeof resourceUpdateWorkflow.confirm>[1]) => resourceUpdateWorkflow.confirm(root, files));
    webview.bind("cancelResourceUpdate", () => resourceUpdateWorkflow.cancel());
    webview.bind("installResourceUpdate", (root: string, files: Parameters<typeof resourceUpdateWorkflow.execute>[1]) => {
      let lastNotification = 0;
      let lastCompletedFiles = -1;
      return resourceUpdateWorkflow.execute(root, files, (progress) => {
        const now = performance.now();
        if (!progress.phase && progress.completedFiles === lastCompletedFiles && now - lastNotification < resourceProgressThrottleMs) return;
        lastNotification = now;
        lastCompletedFiles = progress.completedFiles;
        webview.evaluate(`window.dispatchEvent(new CustomEvent("resource-update-progress", { detail: ${JSON.stringify(progress)} }))`);
      });
    });
    webview.bind("launchGame", startGame);
    webview.bind("closeApp", requestExit);

    process.once("SIGINT", () => webview.terminate());
    process.once("SIGTERM", () => webview.terminate());
    uiDirectory = await mkdtemp(join(tmpdir(), "wwt-ui-"));
    const uiFilePath = join(uiDirectory, "index.html");
    await Promise.all([
      writeFile(uiFilePath, assembleUi(String(html), String(styles), String(renderer), preferences.theme), "utf8"),
      copyFile(resolveBrandAvatarPath(), join(uiDirectory, "carlotta.png")),
    ]);
    webview.navigate(pathToFileURL(uiFilePath).href);
    if (process.argv.includes("--startup") && preferences.silentStart && desktop.trayAvailable) desktop.hide();
    if (!process.argv.includes("--startup") && preferences.autoStartGame)
      setTimeout(() => {
        void readGameSettings()
          .then((settings) => startGame(settings.executablePath, settings.resourceTier))
          .catch((error: unknown) => {
            desktop.show();
            webview.evaluate(`window.dispatchEvent(new CustomEvent("desktop-error", { detail: ${JSON.stringify(error instanceof Error ? error.message : "自动启动游戏失败")} }))`);
          });
      }, 0);
    autoSign.start();
    await webview.run();
    cancelKuroCaptcha();
  } catch (error) {
    webview.destroy();
    throw error;
  } finally {
    autoSign.stop();
    desktop.dispose();
    if (uiDirectory) await rm(uiDirectory, { recursive: true, force: true });
  }
}

let releaseInstance: (() => void) | undefined;
void Promise.resolve()
  .then(() => {
    releaseInstance = acquireProcessLock(appPaths.dataDirectory);
    if (!ensureWebView2Runtime()) return;
    return startClient();
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    showStartupError("鸣潮助手启动失败", message);
    process.exitCode = 1;
  })
  .finally(() => releaseInstance?.());
