import type { GameSettings } from "./model.ts";
import type { OfficialResourceFile, OfficialResourceSource } from "./official-resources.ts";
import type { ResourceUpdateProgress } from "./resource-update.ts";
import { planPatchDownloads } from "./resource-patch-plan.ts";
import { validateDownloadPolicy } from "./download-policy.ts";
import { initializeServerSwitchControls } from "./server-switch-controls.ts";
import { compareResourceVersions } from "./resource-version.ts";
import { bytesPerGibibyte, bytesPerKibibyte, bytesPerMebibyte } from "../units.ts";

const defaultDownloadParallel = "4";
const unlimitedDownloadRate = "0";
const message = (error: unknown): string => (typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error));
const size = (bytes: number): string => (bytes < bytesPerKibibyte ? `${bytes} B` : bytes < bytesPerMebibyte ? `${(bytes / bytesPerKibibyte).toFixed(1)} KB` : bytes < bytesPerGibibyte ? `${(bytes / bytesPerMebibyte).toFixed(1)} MB` : `${(bytes / bytesPerGibibyte).toFixed(2)} GB`);

export function initializeGameControls(): void {
  const element = <T extends HTMLElement>(id: string): T => {
    const node = document.querySelector<T>(`#${id}`);
    if (!node) throw new Error(`界面缺少元素：${id}`);
    return node;
  };
  const path = element<HTMLInputElement>("game-path");
  const tier = element<HTMLSelectElement>("game-tier");
  const browse = element<HTMLButtonElement>("browse-game-path");
  const browseInstall = element<HTMLButtonElement>("browse-game-install");
  const launch = element<HTMLButtonElement>("launch-game");
  const source = element<HTMLSelectElement>("resource-source");
  const purpose = element<HTMLSelectElement>("resource-purpose");
  const check = element<HTMLButtonElement>("check-updates");
  const install = element<HTMLButtonElement>("install-resource-update");
  const cancel = element<HTMLButtonElement>("cancel-resource-update");
  const verify = element<HTMLButtonElement>("check-local-resources");
  const tiers = element<HTMLButtonElement>("inspect-resources");
  const status = element<HTMLElement>("resource-notice");
  const launchStatus = element<HTMLElement>("launcher-notice");
  const info = element<HTMLElement>("installation-info");
  const summary = element<HTMLElement>("resource-summary");
  const progressArea = element<HTMLElement>("resource-progress-area");
  const progress = element<HTMLProgressElement>("resource-download-progress");
  const progressText = element<HTMLElement>("resource-download-status");
  const parallel = element<HTMLInputElement>("download-parallel");
  const limit = element<HTMLInputElement>("download-limit");
  parallel.value = defaultDownloadParallel;
  limit.value = unlimitedDownloadRate;
  let downloadRevision = 0;
  let settingsSaving: Promise<unknown> = Promise.resolve();
  let busy = false;
  let serverBusy = false;
  let launching = false;
  let selecting = false;
  let installing = false;
  let cancelling = false;
  let predownloading = false;
  let revision = 0;
  let pathRevision = 0;
  let downloadLoad = 0;
  let pathLoad = 0;
  let settingsRefreshPending = false;
  let plan: {
    root: string;
    files: OfficialResourceFile[];
    predownload: boolean;
  } | null = null;
  const notify = (node: HTMLElement, text: string, error = false): void => {
    node.textContent = text;
    node.dataset["kind"] = error ? "error" : "info";
  };
  const refresh = (): void => {
    path.disabled = installing || serverBusy || launching || selecting;
    tier.disabled = installing || serverBusy || launching || selecting;
    browse.disabled = installing || serverBusy || launching || selecting;
    browseInstall.disabled = installing || serverBusy || launching || selecting || busy;
    source.disabled = installing || serverBusy;
    purpose.disabled = installing || serverBusy;
    parallel.disabled = installing || serverBusy;
    limit.disabled = installing || serverBusy;
    launch.disabled = !path.value.trim() || serverBusy || launching || (installing && !predownloading) || selecting;
    launch.textContent = launching ? "正在启动…" : "启动游戏";
    check.disabled = busy || installing || serverBusy || !path.value.trim();
    check.textContent = busy ? "正在检查…" : purpose.value === "predownload" ? "检查预下载" : "检查更新";
    install.hidden = plan === null;
    install.disabled = busy || installing || serverBusy || plan === null;
    cancel.hidden = !installing;
    cancel.disabled = cancelling;
    cancel.textContent = predownloading ? "取消预下载" : "取消更新";
    verify.disabled = busy || installing || serverBusy || !path.value.trim();
    tiers.disabled = busy || installing || serverBusy || !path.value.trim();
    serverControls?.refresh();
    if (settingsRefreshPending && !installing && !serverBusy && !launching && !selecting) {
      settingsRefreshPending = false;
      restoreDownloadSettings();
      restoreGameSettings();
    }
  };
  const invalidate = (): void => {
    revision += 1;
    plan = null;
    summary.hidden = true;
    progressArea.hidden = true;
    info.textContent = path.value.trim() ? `游戏位置：${path.value.trim()}` : "请先在启动器选择游戏程序。";
    notify(status, path.value.trim() ? "点击“检查更新”获取版本与下载信息。" : "请先在启动器选择游戏程序。");
    refresh();
  };
  let serverControls: ReturnType<typeof initializeServerSwitchControls> | undefined;
  serverControls = initializeServerSwitchControls(
    path,
    () => !busy && !installing && !launching && !selecting,
    (value) => {
      serverBusy = value;
      refresh();
    },
    invalidate,
  );
  const refreshTiers = async (preferred: string = tier.value): Promise<void> => {
    const requested = path.value;
    const resources = await window.inspectResources(requested);
    if (requested !== path.value) return;
    tier.replaceChildren(new Option("自动（优先 HD）", "auto"));
    for (const value of resources.availableTiers) tier.add(new Option(value.toUpperCase(), value));
    tier.value = [...tier.options].some((option) => option.value === preferred) ? preferred : "auto";
  };
  // 排队保存，避免快速切换设置时较早的写入覆盖最新选择。
  let saving: Promise<unknown> = Promise.resolve();
  const save = (): Promise<unknown> => {
    const requestedPath = path.value.trim();
    const requestedTier = tier.value as GameSettings["resourceTier"];
    saving = saving.catch(() => {}).then(() => window.saveGameSettings(requestedPath, requestedTier));
    return saving;
  };
  path.addEventListener("input", () => {
    pathRevision++;
    invalidate();
    serverControls?.invalidate();
  });
  path.addEventListener("change", () => {
    pathRevision++;
    void save()
      .then(() => refreshTiers())
      .then(() => notify(launchStatus, "路径已保存，可以启动游戏。"))
      .catch((error: unknown) => notify(launchStatus, message(error), true));
  });
  tier.addEventListener("change", () => {
    pathRevision++;
    void save().catch((error: unknown) => notify(launchStatus, message(error), true));
  });
  function saveDownloadSettings(): void {
    downloadRevision++;
    try {
      const policy = validateDownloadPolicy({
        parallel: Number(parallel.value),
        bytesPerSecond: Math.round(Number(limit.value) * bytesPerMebibyte),
      });
      const patch = {
        downloadSource: source.value as OfficialResourceSource,
        downloadParallel: policy.parallel,
        downloadBytesPerSecond: policy.bytesPerSecond,
      };
      settingsSaving = settingsSaving.catch(() => {}).then(() => window.updateAppSettings(patch));
      void settingsSaving.catch((error) => notify(status, message(error), true));
    } catch (error) {
      settingsSaving = Promise.reject(error);
      void settingsSaving.catch(() => {});
      notify(status, message(error), true);
    }
  }
  source.addEventListener("change", () => {
    invalidate();
    saveDownloadSettings();
  });
  purpose.addEventListener("change", invalidate);
  parallel.addEventListener("change", saveDownloadSettings);
  limit.addEventListener("change", saveDownloadSettings);
  function restoreDownloadSettings(): void {
    const requestedRevision = downloadRevision;
    const requestedLoad = ++downloadLoad;
    void settingsSaving
      .catch(() => {})
      .then(() => window.loadAppSettings())
      .then((settings) => {
        if (downloadRevision !== requestedRevision || downloadLoad !== requestedLoad) return;
        if (installing || serverBusy) {
          settingsRefreshPending = true;
          return;
        }
        const previousSource = source.value;
        source.value = settings.downloadSource;
        parallel.value = String(settings.downloadParallel);
        limit.value = String(settings.downloadBytesPerSecond / bytesPerMebibyte);
        if (previousSource !== source.value) invalidate();
      })
      .catch((error) => notify(status, `读取下载设置失败：${message(error)}`, true));
  }
  restoreDownloadSettings();
  browseInstall.addEventListener("click", async () => {
    if (busy || selecting || installing || serverBusy || launching) return;
    selecting = true;
    refresh();
    try {
      const selected = await window.pickGameInstallDirectory();
      if (selected === null) return;
      pathRevision++;
      path.value = selected;
      tier.value = "auto";
      purpose.value = "current";
      serverControls?.invalidate();
      invalidate();
      await window.inspectLocalInstallation(selected);
      await save();
      notify(launchStatus, "安装路径已保存，下载完成后可启动游戏。");
      notify(status, "安装目录已选择，点击“检查更新”获取文件清单与下载量。");
    } catch (error) {
      notify(status, message(error), true);
    } finally {
      selecting = false;
      refresh();
    }
  });
  browse.addEventListener("click", async () => {
    if (selecting || installing || serverBusy || launching) return;
    selecting = true;
    refresh();
    try {
      const selected = await window.pickGameExecutable();
      if (selected === null) return;
      pathRevision++;
      path.value = selected;
      serverControls?.invalidate();
      tier.value = "auto";
      invalidate();
      await save();
      notify(launchStatus, "路径已保存，可以启动游戏。");
      try {
        await refreshTiers("auto");
      } catch (error) {
        notify(launchStatus, `路径已保存；${message(error)}`, true);
      }
    } catch (error) {
      notify(launchStatus, message(error), true);
    } finally {
      selecting = false;
      refresh();
    }
  });
  launch.addEventListener("click", async () => {
    if (launching || serverBusy || (installing && !predownloading) || !path.value.trim()) return;
    launching = true;
    refresh();
    notify(launchStatus, "正在启动游戏…");
    try {
      await save();
      await window.launchGame(path.value.trim(), tier.value as GameSettings["resourceTier"]);
      notify(launchStatus, "游戏已启动，退出后会自动记录本次时长。");
    } catch (error) {
      notify(launchStatus, message(error), true);
    } finally {
      launching = false;
      refresh();
    }
  });
  async function checkResources(repair = false): Promise<void> {
    if (busy || installing || serverBusy || !path.value.trim()) return;
    invalidate();
    const current = revision;
    busy = true;
    refresh();
    try {
      notify(status, "正在读取本地安装…");
      const local = await window.inspectLocalInstallation(path.value.trim());
      if (current !== revision) return;
      notify(status, "正在查询官方版本…");
      const predownload = !repair && purpose.value === "predownload";
      const repairing = repair || local.state === "repairing" || (Boolean(local.version) && local.executableExists === false) || (!local.version && local.executableExists === true);
      const official = await window.fetchOfficialResources(source.value as OfficialResourceSource, predownload, repairing ? null : local.version);
      if (current !== revision) return;
      info.textContent = `本地 ${local.version ?? "未知版本"} → ${predownload ? "预下载" : "官方"} ${official.version} · ${local.rootDirectory}`;
      if (!repairing && local.version && compareResourceVersions(local.version, official.version) >= 0) {
        summary.hidden = false;
        summary.textContent = predownload ? "当前版本已达到预下载版本，无需预下载。" : "资源已是最新，无需更新。";
        notify(status, "检查完成，无需下载。");
        return;
      }
      notify(status, repairing ? "正在校验官方资源，大型文件可能需要几分钟…" : "正在计算更新下载量…");
      const result = await window.planResourceUpdate(local.files, official.files, local.rootDirectory, repairing);
      if (current !== revision) return;
      const pending = new Set(result.entries.filter((entry) => entry.action !== "unchanged").map((entry) => entry.path.toLowerCase()));
      const files = official.files.filter((file) => pending.has(file.path.toLowerCase()));
      const patchPlan = official.patch ? planPatchDownloads(official.patch, files) : null;
      const downloadBytes = patchPlan?.totalBytes ?? result.totalBytes;
      summary.hidden = false;
      if (files.length === 0 && (predownload || (local.version === official.version && local.state !== "repairing" && !official.patch?.deleteFiles.length))) {
        summary.textContent = predownload ? "当前文件已覆盖该版本，无需预下载。" : "资源已是最新，全部文件检查通过。";
        notify(status, "检查完成，无需下载。");
      } else {
        await window.previewResourceUpdate(local.rootDirectory, files);
        if (current !== revision) return;
        plan = { root: local.rootDirectory, files, predownload };
        summary.textContent = `${patchPlan ? "差分更新" : "完整文件更新"} · 预计下载 ${size(downloadBytes)} · 新增 ${result.downloadCount} 个，${predownload ? "待更新" : "替换"} ${result.replaceCount} 个文件；已有缓存会自动复用。${official.patchNotice ?? ""}${patchPlan ? " 差分失败时会下载完整文件。" : ""}`;
        install.textContent = `${predownload ? "开始预下载" : "下载并更新"} · ${size(downloadBytes)}`;
        notify(status, predownload ? "检查完成，点击“开始预下载”缓存下一版本资源。" : repairing ? "校验完成，点击“下载并更新”修复资源。" : "检查完成，点击“下载并更新”开始安装。");
      }
    } catch (error) {
      if (current === revision) {
        plan = null;
        notify(status, `检查失败：${message(error)}。可点击“检查更新”重试。`, true);
      }
    } finally {
      busy = false;
      refresh();
    }
  }
  check.addEventListener("click", () => checkResources());
  install.addEventListener("click", async () => {
    if (plan === null || busy || installing || serverBusy) return;
    const approved = plan;
    plan = null;
    installing = true;
    predownloading = approved.predownload;
    cancelling = false;
    progressArea.hidden = false;
    progress.value = 0;
    progressText.textContent = "正在准备下载…";
    refresh();
    try {
      await settingsSaving;
      await window.confirmResourceUpdate(approved.root, approved.files);
      // 确认尚未完成时也可能收到取消请求。
      if (cancelling) {
        notify(status, "更新已取消。可重新检查更新。");
        progressText.textContent = "更新已取消。";
        return;
      }
      notify(status, predownloading ? "正在预下载，当前游戏可以继续运行。" : "正在下载并更新，请保持客户端运行。");
      const result = await window.installResourceUpdate(approved.root, approved.files);
      progress.value = 1;
      progressText.textContent = predownloading ? "预下载完成。" : "资源安装完成。";
      notify(status, predownloading ? "预下载完成，更新开放后会自动复用已校验的缓存。" : "更新完成，可以启动游戏。");
      if (result?.notice) status.textContent += ` ${result.notice}`;
      summary.textContent = predownloading ? "下一版本资源已缓存。" : "资源更新完成。";
      if (predownloading) return;
      try {
        const local = await window.inspectLocalInstallation(path.value.trim());
        info.textContent = `本地版本 ${local.version ?? "未知"} · ${local.rootDirectory}`;
        await refreshTiers();
      } catch (error) {
        notify(status, `更新已完成，读取版本失败：${message(error)}`, true);
      }
    } catch (error) {
      notify(status, `${message(error)}。可重新检查更新。`, true);
      progressText.textContent = message(error);
    } finally {
      installing = false;
      cancelling = false;
      predownloading = false;
      refresh();
    }
  });
  cancel.addEventListener("click", async () => {
    if (!installing || cancelling) return;
    cancelling = true;
    refresh();
    progressText.textContent = "正在取消，等待文件清理与恢复完成；已下载部分会保留供下次续传。";
    try {
      await window.cancelResourceUpdate();
    } catch (error) {
      if (installing) {
        cancelling = false;
        notify(status, message(error), true);
        refresh();
      }
    }
  });
  window.addEventListener("resource-update-progress", (event) => {
    if (!installing || cancelling) return;
    const data = (event as CustomEvent<ResourceUpdateProgress>).detail;
    if (data.phase === "patch" || data.phase === "verify") {
      progress.value = data.totalBytes === 0 ? 0 : data.completedBytes / data.totalBytes;
      progressText.textContent = `${data.phase === "patch" ? "正在应用差分补丁" : "正在校验资源"} · ${data.path}`;
      return;
    }
    progress.value = data.totalBytes === 0 ? 1 : data.completedBytes / data.totalBytes;
    progressText.textContent = data.completedFiles === data.totalFiles ? (predownloading ? "下载及校验完成，正在保存预下载记录…" : "下载及校验完成，正在安装文件…") : `${data.path} · ${size(data.completedBytes)} / ${size(data.totalBytes)} · 已校验 ${data.completedFiles}/${data.totalFiles} 个文件`;
  });
  verify.addEventListener("click", () => checkResources(true));
  tiers.addEventListener("click", async () => {
    try {
      await refreshTiers();
      notify(
        status,
        `可用档位：${
          [...tier.options]
            .slice(1)
            .map((option) => option.value.toUpperCase())
            .join("、") || "未检测到"
        }。`,
      );
    } catch (error) {
      notify(status, message(error), true);
    }
  });
  function restoreGameSettings(): void {
    const requestedRevision = pathRevision;
    const requestedLoad = ++pathLoad;
    void saving
      .catch(() => {})
      .then(() => window.loadGameSettings())
      .then(async (settings) => {
        if (requestedRevision !== pathRevision || requestedLoad !== pathLoad) return;
        if (installing || serverBusy || launching || selecting) {
          settingsRefreshPending = true;
          return;
        }
        if (path.value !== settings.executablePath) serverControls?.invalidate();
        path.value = settings.executablePath;
        invalidate();
        notify(launchStatus, settings.executablePath ? "准备就绪，点击“启动游戏”。" : "首次使用，请选择游戏程序。");
        if (settings.executablePath) await refreshTiers(settings.resourceTier);
      })
      .catch((error: unknown) => notify(launchStatus, message(error), true));
  }
  window.addEventListener("app-settings-changed", () => {
    if (installing || serverBusy || launching || selecting) {
      settingsRefreshPending = true;
      return;
    }
    restoreDownloadSettings();
    restoreGameSettings();
  });
  restoreGameSettings();
  refresh();
}
