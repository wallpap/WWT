import type { AppUpdateOffer, AppUpdateProgress, PreparedAppUpdate } from "./updater.ts";
import { appErrorMessage } from "./error-message.ts";
import { bytesPerMebibyte } from "../units.ts";

export function initializeAppUpdateControls(): void {
  const find = <T extends HTMLElement>(id: string): T => document.querySelector<T>(`#${id}`)!;
  const source = find<HTMLInputElement>("app-update-source"),
    check = find<HTMLButtonElement>("app-update-check"),
    download = find<HTMLButtonElement>("app-update-download"),
    install = find<HTMLButtonElement>("app-update-install"),
    cancel = find<HTMLButtonElement>("app-update-cancel");
  const notice = find<HTMLElement>("app-update-notice"),
    details = find<HTMLElement>("app-update-details"),
    notes = find<HTMLElement>("app-update-notes"),
    progress = find<HTMLProgressElement>("app-update-progress");
  let offer: AppUpdateOffer | null = null,
    prepared: PreparedAppUpdate | null = null,
    portable = false,
    busy = "",
    revision = 0;
  function buttons(): void {
    source.disabled = Boolean(busy);
    check.disabled = Boolean(busy) || !source.value.trim();
    download.disabled = Boolean(busy) || !portable || !offer?.available || Boolean(prepared);
    install.disabled = Boolean(busy) || !prepared;
    cancel.hidden = busy !== "download";
  }
  async function query(automatic = false): Promise<void> {
    if (busy || !source.value.trim()) return;
    busy = "check";
    offer = null;
    prepared = null;
    details.hidden = true;
    const current = ++revision;
    buttons();
    notice.textContent = "正在检查应用更新…";
    notice.dataset["kind"] = "info";
    try {
      const result = await window.checkAppUpdate(source.value.trim());
      if (current !== revision) return;
      offer = result;
      notes.textContent = result.release.notes || "该版本没有附加更新说明。";
      details.hidden = false;
      notice.textContent = result.available ? `当前 ${result.currentVersion} → ${result.release.version} · 更新包 ${(result.release.asset.size / bytesPerMebibyte).toFixed(1)} MiB。${portable ? "可先下载并校验，再安装重启。" : "自动安装需使用便携版。"}` : `当前版本 ${result.currentVersion}，发布源中没有更新版本。`;
      if (automatic && result.available) {
        const banner = find<HTMLElement>("app-notice");
        banner.hidden = false;
        banner.textContent = `发现应用新版本 ${result.release.version}，可在设置页查看并更新。`;
      }
    } catch (error) {
      if (current === revision) {
        notice.textContent = appErrorMessage(error, "检查应用更新失败");
        notice.dataset["kind"] = "error";
      }
    } finally {
      busy = "";
      buttons();
    }
  }
  source.addEventListener("input", () => {
    revision++;
    offer = null;
    prepared = null;
    details.hidden = true;
    buttons();
  });
  check.addEventListener("click", () => query());
  download.addEventListener("click", async () => {
    if (busy || !offer || !portable) return;
    busy = "download";
    const current = revision;
    buttons();
    progress.hidden = false;
    progress.value = 0;
    notice.textContent = "正在下载应用更新包…";
    try {
      const result = await window.prepareAppUpdate(offer.id);
      if (current !== revision) return;
      prepared = result;
      progress.value = 1;
      notice.textContent = `${prepared.version} 已校验并解压，共 ${prepared.fileCount} 个文件。点击“安装并重启”应用更新。`;
      notice.dataset["kind"] = "info";
    } catch (error) {
      notice.textContent = appErrorMessage(error, "应用更新包下载失败");
      notice.dataset["kind"] = "error";
    } finally {
      busy = "";
      progress.hidden = true;
      buttons();
    }
  });
  cancel.addEventListener("click", async () => {
    cancel.disabled = true;
    try {
      await window.cancelAppUpdate();
    } catch (error) {
      notice.textContent = appErrorMessage(error, "取消应用更新失败");
      notice.dataset["kind"] = "error";
    } finally {
      cancel.disabled = false;
    }
  });
  install.addEventListener("click", async () => {
    if (busy || !prepared) return;
    busy = "install";
    buttons();
    notice.textContent = "安装器正在准备，随后退出并重启应用…";
    try {
      await window.installAppUpdate(prepared.id);
    } catch (error) {
      busy = "";
      buttons();
      notice.textContent = appErrorMessage(error, "应用更新安装器启动失败");
      notice.dataset["kind"] = "error";
    }
  });
  window.addEventListener("app-update-progress", (event) => {
    if (busy !== "download") return;
    const update = (event as CustomEvent<AppUpdateProgress>).detail;
    progress.value = update.totalBytes ? update.completedBytes / update.totalBytes : 0;
    notice.textContent = update.phase === "verify" ? "正在校验应用更新包 SHA-256…" : update.phase === "extract" ? "正在检查并解压便携包…" : `已下载 ${(update.completedBytes / bytesPerMebibyte).toFixed(1)} / ${(update.totalBytes / bytesPerMebibyte).toFixed(1)} MiB`;
  });
  const current = revision;
  async function restore(): Promise<void> {
    try {
      const [info, settings] = await Promise.all([window.appUpdateInfo(), window.loadAppSettings()]);
      portable = info.portable;
      if (current === revision && !busy) source.value = settings.appUpdateSource;
      if (!busy) notice.textContent = info.lastResult ? `当前 ${info.version} · 上次更新：${info.lastResult.message}` : `当前 ${info.version} · 保存本项目的发布源后，可检查应用更新。`;
      buttons();
      if (current === revision && settings.checkAppUpdates && settings.appUpdateSource) void query(true);
    } catch {
      notice.textContent = "应用更新信息暂不可用。";
    }
  }
  void restore();
  buttons();
}
