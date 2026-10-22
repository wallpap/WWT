import type { AppSettings } from "./settings.ts";
import { appErrorMessage } from "./error-message.ts";
import { percentageScale } from "../units.ts";

export function initializeSettingsControls(): void {
  const find = <T extends HTMLElement>(id: string): T => document.querySelector<T>(`#${id}`)!;
  const form = find<HTMLFormElement>("app-settings-form"),
    notice = find<HTMLElement>("app-settings-notice"),
    save = find<HTMLButtonElement>("app-settings-save");
  const startPage = find<HTMLSelectElement>("app-start-page"),
    theme = find<HTMLSelectElement>("app-theme"),
    close = find<HTMLSelectElement>("app-close-action"),
    shortcut = find<HTMLInputElement>("app-shortcut");
  const width = find<HTMLInputElement>("app-width"),
    height = find<HTMLInputElement>("app-height"),
    scale = find<HTMLInputElement>("app-scale");
  const updateSource = find<HTMLInputElement>("app-update-source");
  const flags = [
    ["hideOnGameStart", "app-hide-on-launch"],
    ["exitOnGameEnd", "app-exit-on-game-end"],
    ["autoStartGame", "app-auto-start-game"],
    ["silentStart", "app-silent-start"],
    ["startWithWindows", "app-start-with-windows"],
    ["checkAppUpdates", "app-check-updates"],
  ] as const;
  const inputs = flags.map(([key, id]) => ({
    key,
    control: find<HTMLInputElement>(id),
  }));
  const startup = find<HTMLInputElement>("app-start-with-windows");
  let revision = 0,
    busy = false,
    portable = false,
    navigated = false,
    first = true;
  function apply(settings: AppSettings): void {
    document.body.style.zoom = String(settings.uiScale / percentageScale);
    document.documentElement.dataset["theme"] = settings.theme;
    theme.value = settings.theme;
    startPage.value = settings.startPage;
    close.value = settings.closeAction;
    shortcut.value = settings.showShortcut;
    updateSource.value = settings.appUpdateSource;
    width.value = String(settings.windowWidth);
    height.value = String(settings.windowHeight);
    scale.value = String(settings.uiScale);
    for (const { key, control } of inputs) control.checked = settings[key];
  }
  async function restore(): Promise<void> {
    const current = revision;
    try {
      const [settings, status] = await Promise.all([window.loadAppSettings(), window.desktopStatus()]);
      portable = status.portable;
      startup.disabled = busy || !portable;
      if (current !== revision) return;
      apply(settings);
      save.disabled = false;
      notice.textContent = status.notice ?? `设置已读取。${portable ? "" : "Windows 登录启动可在便携版中设置。"}窗口尺寸与启动页在下次启动时生效。`;
      notice.dataset["kind"] = status.notice ? "error" : "info";
      if (first && !navigated) document.querySelector<HTMLButtonElement>(`[data-page-target="${settings.startPage}"]`)?.click();
      first = false;
    } catch (error) {
      notice.textContent = appErrorMessage(error, "读取应用设置失败");
      notice.dataset["kind"] = "error";
    }
  }
  for (const input of [startPage, theme, close, shortcut, width, height, scale, updateSource, ...inputs.map((item) => item.control)])
    input.addEventListener("input", () => {
      revision++;
    });
  theme.addEventListener("change", () => {
    document.documentElement.dataset["theme"] = theme.value;
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    save.disabled = true;
    const current = ++revision;
    const patch: Partial<AppSettings> = {
      startPage: startPage.value as AppSettings["startPage"],
      closeAction: close.value as AppSettings["closeAction"],
      showShortcut: shortcut.value,
      windowWidth: Number(width.value),
      windowHeight: Number(height.value),
      uiScale: Number(scale.value),
      theme: theme.value as AppSettings["theme"],
      appUpdateSource: updateSource.value,
    };
    for (const { key, control } of inputs) if (key !== "startWithWindows" || portable) patch[key] = control.checked;
    try {
      const settings = await window.updateAppSettings(patch);
      if (current === revision) apply(settings);
      notice.textContent = "设置已保存。主题、缩放、关闭行为和快捷键已生效，窗口尺寸与启动页在下次启动时应用。";
      notice.dataset["kind"] = "info";
      window.dispatchEvent(new Event("app-settings-changed"));
    } catch (error) {
      notice.textContent = appErrorMessage(error, "保存应用设置失败");
      notice.dataset["kind"] = "error";
    } finally {
      busy = false;
      save.disabled = false;
    }
  });
  find<HTMLButtonElement>("app-hide").addEventListener("click", async () => {
    try {
      await window.hideToTray();
    } catch (error) {
      notice.textContent = appErrorMessage(error, "隐藏窗口失败");
    }
  });
  find<HTMLButtonElement>("app-exit").addEventListener("click", () => {
    void window.closeApp();
  });
  window.addEventListener("page-changed", (event) => {
    navigated = true;
    if ((event as CustomEvent<string>).detail === "settings" && !busy) void restore();
  });
  window.addEventListener("app-settings-changed", () => {
    if (!busy) void restore();
  });
  window.addEventListener("desktop-error", (event) => {
    const message = (event as CustomEvent<string>).detail;
    notice.textContent = message;
    notice.dataset["kind"] = "error";
    const banner = find<HTMLElement>("app-notice");
    banner.textContent = message;
    banner.hidden = false;
  });
  void restore();
}
