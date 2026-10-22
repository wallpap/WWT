import type { MigrationKind, MigrationPreview } from "./service.ts";
import type { MigrationSource } from "./read.ts";
import { millisecondsPerMinute } from "../units.ts";

export function initializeMigrationControls(): void {
  const find = <T extends HTMLElement>(id: string): T => document.querySelector<T>(`#${id}`)!;
  const source = find<HTMLSelectElement>("migration-source");
  const path = find<HTMLInputElement>("migration-path");
  const player = find<HTMLInputElement>("migration-player");
  const playerField = find<HTMLElement>("migration-player-field");
  const browse = find<HTMLButtonElement>("migration-browse");
  const previewButton = find<HTMLButtonElement>("migration-preview");
  const gachaButton = find<HTMLButtonElement>("migration-gacha");
  const timeButton = find<HTMLButtonElement>("migration-time");
  const challengeButton = find<HTMLButtonElement>("migration-challenges");
  const signButton = find<HTMLButtonElement>("migration-signs");
  const accountButton = find<HTMLButtonElement>("migration-accounts");
  const settingsButton = find<HTMLButtonElement>("migration-settings");
  const archiveButton = find<HTMLButtonElement>("migration-archive");
  const summary = find<HTMLElement>("migration-summary");
  const notice = find<HTMLElement>("migration-notice");
  let preview: MigrationPreview | null = null;
  let busy = false;
  let revision = 0;
  function refresh(): void {
    source.disabled = busy;
    path.disabled = busy;
    player.disabled = busy;
    browse.disabled = busy;
    previewButton.disabled = busy || !path.value.trim();
    gachaButton.disabled = busy || !preview?.gachaCount;
    timeButton.disabled = busy || !preview?.gameTimeCount;
    challengeButton.disabled = busy || !preview?.challengeCount;
    signButton.disabled = busy || !preview?.signCount;
    accountButton.disabled = busy || !preview?.accountRoleCount;
    settingsButton.disabled = busy || !preview?.settingCount;
    archiveButton.disabled = busy || !(preview && (preview.battleCount || preview.localPlayerCount || preview.catalogRoleCount));
    playerField.hidden = source.value !== "xlsx";
  }
  function invalidate(): void {
    revision++;
    preview = null;
    summary.textContent = "";
    refresh();
  }
  function failure(error: unknown): void {
    notice.dataset["kind"] = "error";
    notice.textContent = typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : "数据迁移失败，请重新读取来源后重试";
  }
  source.addEventListener("change", () => {
    path.value = "";
    player.value = "";
    invalidate();
  });
  path.addEventListener("input", invalidate);
  player.addEventListener("input", invalidate);
  browse.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    refresh();
    try {
      const selected = await window.pickMigrationSource(source.value as MigrationSource);
      if (selected) {
        path.value = selected;
        invalidate();
      }
    } catch (error) {
      failure(error);
    } finally {
      busy = false;
      refresh();
    }
  });
  previewButton.addEventListener("click", async () => {
    if (busy || !path.value.trim()) return;
    invalidate();
    busy = true;
    refresh();
    const current = revision;
    notice.dataset["kind"] = "info";
    notice.textContent = "正在读取迁移来源…";
    try {
      const result = await window.previewMigration(source.value as MigrationSource, path.value, player.value);
      if (current !== revision) return;
      preview = result;
      summary.textContent = `${result.playerCount} 个玩家 · 抽卡 ${result.gachaCount} 条 / ${result.gachaPulls} 抽 · 时长 ${result.gameTimeCount} 条 / ${Math.floor(result.gameTimeDuration / millisecondsPerMinute)} 分钟 · 挑战历史 ${result.challengeCount ?? 0} 个周期 · 签到历史 ${result.signCount ?? 0} 条`;
      summary.textContent += ` · 账号角色 ${result.accountRoleCount ?? 0} 个 · 设置 ${result.settingCount ?? 0} 项`;
      summary.textContent += ` · 战斗日报 ${result.battleCount ?? 0} 条 · 本地玩家 ${result.localPlayerCount ?? 0} 个 · 角色图鉴 ${result.catalogRoleCount ?? 0} 个`;
      notice.textContent = "来源已读取，选择要合并的数据。";
    } catch (error) {
      if (current === revision) failure(error);
    } finally {
      busy = false;
      refresh();
    }
  });
  async function importRecords(kind: MigrationKind): Promise<void> {
    if (busy || !preview) return;
    busy = true;
    refresh();
    notice.dataset["kind"] = "info";
    notice.textContent = "正在合并记录…";
    try {
      const result = await window.importMigration(preview.id, kind);
      const events: Record<MigrationKind, string> = {
        gacha: "gacha-records-changed",
        "game-time": "game-time-changed",
        challenges: "challenge-history-changed",
        signs: "sign-history-changed",
        accounts: "kuro-accounts-imported",
        settings: "app-settings-changed",
        archive: "local-archive-changed",
      };
      window.dispatchEvent(new Event(events[kind]));
      notice.textContent = `合并完成：新增或更新 ${result.addedCount} 条，跳过重复 ${result.duplicateCount} 条。`;
    } catch (error) {
      failure(error);
    } finally {
      busy = false;
      refresh();
    }
  }
  gachaButton.addEventListener("click", () => {
    void importRecords("gacha");
  });
  timeButton.addEventListener("click", () => {
    void importRecords("game-time");
  });
  challengeButton.addEventListener("click", () => importRecords("challenges"));
  signButton.addEventListener("click", () => importRecords("signs"));
  accountButton.addEventListener("click", () => importRecords("accounts"));
  settingsButton.addEventListener("click", () => importRecords("settings"));
  archiveButton.addEventListener("click", () => importRecords("archive"));
  refresh();
}
