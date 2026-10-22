import type { GachaRecord, GachaSummary } from "../gacha/model.ts";
import type { GameLaunchPlan, GameResourceStatus, GameSettings } from "../game/model.ts";
import type { LocalInstallationInfo } from "../game/local-manifest.ts";
import type { ResourceCheckSummary } from "../game/resource-check.ts";
import type { OfficialResourceManifest, OfficialResourceSource } from "../game/official-resources.ts";
import type { ResourcePlan } from "../game/resource-plan.ts";
import type { OfficialResourceFile } from "../game/official-resources.ts";
import type { ResourceUpdateResult } from "../game/resource-update.ts";
import type { GameTimeLogImportResult } from "../game-time/log-import.ts";
import type { GameTimeRecord, GameTimeSummary } from "../game-time/model.ts";

declare global {
  interface Window {
    loadGameImage(url: string): Promise<string>;
    loadAutoSignStatus(): Promise<import("../kujiequ/auto-sign.ts").AutoSignStatus>;
    appUpdateInfo(): Promise<{
      version: string;
      portable: boolean;
      lastResult: { status: string; message: string } | null;
    }>;
    checkAppUpdate(source: string): Promise<import("../app/updater.ts").AppUpdateOffer>;
    prepareAppUpdate(id: string): Promise<import("../app/updater.ts").PreparedAppUpdate>;
    installAppUpdate(id: string): Promise<void>;
    cancelAppUpdate(): Promise<void>;
    desktopStatus(): Promise<{
      portable: boolean;
      trayAvailable: boolean;
      notice: string | null;
    }>;
    hideToTray(): Promise<void>;
    copyText(text: string): Promise<void>;
    openGameLink(key: import("../game/links.ts").GameLink): Promise<void>;
    listGameScreenshots(executable: string): Promise<import("../game/screenshots.ts").GameScreenshot[]>;
    readGameScreenshot(executable: string, path: string): Promise<string>;
    openGameScreenshot(executable: string, path: string): Promise<void>;
    openScreenshotFolder(executable: string): Promise<void>;
    loadRedemptionCodes(force: boolean, localOnly?: boolean): Promise<import("../app/redemption-codes.ts").RedemptionCodes>;
    runServerOperation(
      executablePath: string,
      action: import("../game/server-switch-controls.ts").ServerOperation,
      source: import("../game/server-switch.ts").SwitchSource,
    ): Promise<{
      status: import("../game/server-switch.ts").ServerSwitchStatus;
      notice?: string;
    }>;
    cancelServerOperation(): Promise<void>;
    loadLocalArchive(): Promise<import("../local-data/model.ts").LocalArchive>;
    importBattleLogs(executablePath: string): Promise<import("../local-data/battle-log-import.ts").BattleLogImportResult>;
    loadAppSettings(): Promise<import("../app/settings.ts").AppSettings>;
    updateAppSettings(patch: Partial<import("../app/settings.ts").AppSettings>): Promise<import("../app/settings.ts").AppSettings>;
    pickMigrationSource(source: import("../migration/read.ts").MigrationSource): Promise<string | null>;
    previewMigration(source: import("../migration/read.ts").MigrationSource, path: string, playerId: string): Promise<import("../migration/service.ts").MigrationPreview>;
    importMigration(id: string, kind: import("../migration/service.ts").MigrationKind): Promise<{ addedCount: number; duplicateCount: number }>;
    previewKuroBatchSign(): Promise<import("../kujiequ/sign.ts").SignTarget[]>;
    submitKuroBatchSign(targets: import("../kujiequ/sign.ts").SignTarget[]): Promise<import("../kujiequ/sign.ts").BatchSignItem[]>;
    loadKuroSign(force?: boolean): Promise<import("../kujiequ/sign.ts").SignView>;
    loadLocalKuroSignHistory(): ReturnType<import("../kujiequ/sign.ts").SignService["localHistory"]>;
    submitKuroSign(accountId: string, roleId: string, serverId: string): Promise<import("../kujiequ/sign.ts").SignResult>;
    loadKuroDaily(force: boolean, localOnly?: boolean): Promise<import("../kujiequ/daily.ts").DailyView>;
    syncKuroDaily(): Promise<import("../kujiequ/daily.ts").DailyView>;
    loadKuroAccounts(): Promise<import("../kujiequ/model.ts").AccountView>;
    sendKuroSms(phone: string): Promise<void>;
    loginKuroAccount(phone: string, code: string): Promise<import("../kujiequ/model.ts").AccountView>;
    loginKuroToken(token: string, did: string, source: "android" | "h5"): Promise<import("../kujiequ/model.ts").AccountView>;
    selectKuroRole(accountId: string, roleId: string): Promise<import("../kujiequ/model.ts").AccountView>;
    removeKuroAccount(accountId: string): Promise<import("../kujiequ/model.ts").AccountView>;
    refreshKuroRoles(): Promise<import("../kujiequ/model.ts").AccountView>;
    loadKuroRoleData(force: boolean): Promise<import("../kujiequ/role.ts").KuroRoleView>;
    loadLocalKuroRoleData(): Promise<import("../kujiequ/role.ts").KuroRoleView>;
    loadKuroRoleDetail(roleId: string, localOnly?: boolean): Promise<import("../kujiequ/role.ts").KuroRoleDetail>;
    loadKuroChallenges(force: boolean): Promise<import("../kujiequ/challenge.ts").ChallengeView>;
    loadKuroChallengeHistory(): Promise<import("../kujiequ/challenge-history.ts").ChallengeSnapshot[]>;
    loadKuroBriefingPeriods(force: boolean, localOnly?: boolean): Promise<import("../kujiequ/briefing.ts").BriefingPeriods>;
    loadKuroBriefingDetail(kind: import("../kujiequ/briefing.ts").BriefingKind, index: string, force: boolean, localOnly?: boolean): Promise<import("../kujiequ/briefing.ts").BriefingView>;
    loadKuroBriefingHistory(kind: import("../kujiequ/briefing.ts").BriefingKind, synchronize: boolean): Promise<import("../kujiequ/briefing-history.ts").BriefingHistory>;
    loadKuroCalculator(force: boolean, localOnly?: boolean): Promise<import("../kujiequ/calculator.ts").CalculatorView>;
    calculateKuroRole(aim: import("../kujiequ/calculator.ts").RoleAim): Promise<import("../kujiequ/calculator.ts").CalculatorResult>;
    loadKuroCultivation(roleId: string): Promise<import("../kujiequ/cultivation.ts").RoleCultivation>;
    calculateKuroWeapon(aim: import("../kujiequ/calculator.ts").WeaponAim): Promise<import("../kujiequ/calculator.ts").CalculatorResult>;
    loadKuroCalculatorTargets(): Promise<import("../kujiequ/calculator-targets.ts").CalculatorTargets>;
    saveKuroCalculatorTarget(target: import("../kujiequ/calculator-targets.ts").CalculatorTarget): Promise<import("../kujiequ/calculator-targets.ts").CalculatorTargets>;
    removeKuroCalculatorTarget(kind: "role" | "weapon", id: string): Promise<import("../kujiequ/calculator-targets.ts").CalculatorTargets>;
    calculateKuroRoleBatch(aims: import("../kujiequ/calculator.ts").RoleAim[]): Promise<import("../kujiequ/calculator.ts").CalculatorResult>;
    calculateKuroWeaponBatch(aims: import("../kujiequ/calculator.ts").WeaponAim[]): Promise<import("../kujiequ/calculator.ts").CalculatorResult>;
    loadRecords(): Promise<{ records: GachaRecord[] }>;
    queryGachaRecords(link: string): ReturnType<typeof import("../gacha/service.ts").queryGachaRecords>;
    importRecords(
      payload: { format: "json" | "xlsx"; data: string },
      playerId: string,
    ): Promise<{
      records: GachaRecord[];
      addedCount: number;
      duplicateCount: number;
    }>;
    summarizeRecords(records: GachaRecord[]): Promise<GachaSummary>;
    exportRecords(records: GachaRecord[], format: "json" | "xlsx"): Promise<{ path: string }>;
    closeApp(): Promise<void>;
    loadGameSettings(): Promise<GameSettings>;
    pickGameExecutable(): Promise<string | null>;
    pickGameInstallDirectory(): Promise<string | null>;
    pickGachaLogFile(): Promise<string | null>;
    extractGachaLinkFromLog(path: string): Promise<string>;
    saveGameSettings(executablePath: string, resourceTier: GameSettings["resourceTier"]): Promise<GameSettings>;
    inspectGame(executablePath: string, resourceTier: GameSettings["resourceTier"]): Promise<GameLaunchPlan>;
    inspectResources(executablePath: string): Promise<GameResourceStatus>;
    inspectLocalInstallation(executablePath: string): Promise<LocalInstallationInfo>;
    checkLocalResources(rootDirectory: string, files: LocalInstallationInfo["files"]): Promise<ResourceCheckSummary>;
    fetchOfficialResources(source: OfficialResourceSource, predownload?: boolean, fromVersion?: string | null): Promise<OfficialResourceManifest>;
    planResourceUpdate(local: LocalInstallationInfo["files"], official: OfficialResourceManifest["files"], root: string, repair?: boolean): Promise<ResourcePlan>;
    previewResourceUpdate(root: string, files: OfficialResourceFile[]): Promise<number>;
    confirmResourceUpdate(root: string, files: OfficialResourceFile[]): Promise<void>;
    installResourceUpdate(root: string, files: OfficialResourceFile[]): Promise<ResourceUpdateResult>;
    cancelResourceUpdate(): Promise<boolean>;
    launchGame(executablePath: string, resourceTier: GameSettings["resourceTier"]): Promise<GameLaunchPlan>;
    previewGameLaunch(executablePath: string, resourceTier: GameSettings["resourceTier"]): Promise<GameLaunchPlan>;
    confirmGameLaunch(executablePath: string, resourceTier: GameSettings["resourceTier"]): Promise<GameLaunchPlan>;
    loadGameTime(): Promise<GameTimeRecord[]>;
    summarizeGameTime(records: GameTimeRecord[], today: string): Promise<GameTimeSummary>;
    addGameTime(record: Omit<GameTimeRecord, "id">): Promise<GameTimeRecord[]>;
    deleteGameTime(id: number): Promise<GameTimeRecord[]>;
    importGameTimeLogs(executablePath: string): Promise<GameTimeLogImportResult>;
  }
}

export {};
