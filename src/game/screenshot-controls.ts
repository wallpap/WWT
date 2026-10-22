import { gameLinks, type GameLink } from "./links.ts";
import type { GameScreenshot } from "./screenshots.ts";
import { bytesPerMebibyte } from "../units.ts";

export function initializeScreenshotControls(): void {
  const find = <T extends HTMLElement>(id: string): T => document.querySelector<T>(`#${id}`)!;
  const links = find<HTMLElement>("game-links");
  const notice = find<HTMLElement>("screenshots-notice");
  for (const [key, link] of Object.entries(gameLinks)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button";
    button.textContent = link.name;
    button.addEventListener("click", async () => {
      try {
        await window.openGameLink(key as GameLink);
      } catch {
        notice.textContent = "无法打开浏览器，请检查系统默认浏览器设置。";
      }
    });
    links.append(button);
  }
  const refresh = find<HTMLButtonElement>("screenshots-refresh"),
    folder = find<HTMLButtonElement>("screenshots-folder"),
    open = find<HTMLButtonElement>("screenshots-open"),
    previous = find<HTMLButtonElement>("screenshots-previous"),
    next = find<HTMLButtonElement>("screenshots-next");
  const list = find<HTMLSelectElement>("screenshots-select"),
    image = find<HTMLImageElement>("screenshots-preview");
  let files: GameScreenshot[] = [];
  let executable = "";
  let revision = 0;
  let loading = false;
  function buttons(): void {
    const index = files.findIndex((file) => file.path === list.value);
    previous.disabled = loading || index <= 0;
    next.disabled = loading || index < 0 || index >= files.length - 1;
    open.disabled = loading || index < 0;
    list.disabled = loading || !files.length;
  }
  async function preview(): Promise<void> {
    const path = list.value,
      current = ++revision;
    image.hidden = true;
    image.removeAttribute("src");
    buttons();
    const file = files.find((file) => file.path === path);
    if (!file) return;
    notice.textContent = `正在读取 ${file.name}…`;
    notice.dataset["kind"] = "info";
    try {
      const data = await window.readGameScreenshot(executable, path);
      if (current !== revision) return;
      image.src = data;
      image.alt = file.name;
      image.hidden = false;
      notice.textContent = `${files.indexOf(file) + 1} / ${files.length} · ${file.name} · ${(file.size / bytesPerMebibyte).toFixed(2)} MiB · ${new Date(file.modifiedAt).toLocaleString("zh-CN")}`;
    } catch (error) {
      if (current === revision) {
        notice.textContent = error instanceof Error ? error.message : "截图预览失败";
        notice.dataset["kind"] = "error";
      }
    }
  }
  async function load(): Promise<void> {
    if (loading) return;
    loading = true;
    refresh.disabled = true;
    files = [];
    list.replaceChildren();
    image.hidden = true;
    image.removeAttribute("src");
    buttons();
    const current = ++revision;
    try {
      const settings = await window.loadGameSettings();
      const screenshots = await window.listGameScreenshots(settings.executablePath);
      if (current !== revision) return;
      executable = settings.executablePath;
      files = screenshots;
      list.replaceChildren(...files.map((file) => new Option(`${file.name} · ${new Date(file.modifiedAt).toLocaleString("zh-CN")}`, file.path)));
      if (!files.length) {
        image.hidden = true;
        image.removeAttribute("src");
        notice.textContent = "当前游戏暂无截图。";
      } else await preview();
    } catch (error) {
      notice.textContent = error instanceof Error ? error.message : "读取截图列表失败";
      notice.dataset["kind"] = "error";
    } finally {
      loading = false;
      refresh.disabled = false;
      buttons();
    }
  }
  list.addEventListener("change", () => {
    void preview();
  });
  refresh.addEventListener("click", () => {
    void load();
  });
  for (const [button, delta] of [
    [previous, -1],
    [next, 1],
  ] as const)
    button.addEventListener("click", () => {
      const index = files.findIndex((file) => file.path === list.value);
      const file = files[index + delta];
      if (file) {
        list.value = file.path;
        void preview();
      }
    });
  folder.addEventListener("click", async () => {
    try {
      const settings = await window.loadGameSettings();
      await window.openScreenshotFolder(settings.executablePath);
    } catch (error) {
      notice.textContent = error instanceof Error ? error.message : "打开截图目录失败";
    }
  });
  open.addEventListener("click", async () => {
    if (!list.value) return;
    try {
      await window.openGameScreenshot(executable, list.value);
    } catch (error) {
      notice.textContent = error instanceof Error ? error.message : "打开截图失败";
    }
  });
  window.addEventListener("page-changed", (event) => {
    if ((event as CustomEvent<string>).detail === "screenshots") void load();
  });
  buttons();
}
