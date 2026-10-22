import type { DailyMetric } from "./daily.ts";
import { gameIcon, gameImage } from "./game-images.ts";

export function renderKuroMetrics(container: HTMLElement, metrics: DailyMetric[]): void {
  const children = metrics.map((metric) => {
    const item = document.createElement("article");
    item.className = "metric";
    const name = document.createElement("span");
    name.className = "metric-label";
    name.textContent = metric.name;
    const image = gameImage(metric.iconUrl ?? "", "metric-game-icon", gameIcon(metric.icon ?? "") || gameIcon(metric.name));
    if (image) name.append(image);
    const value = document.createElement("strong");
    value.textContent = metric.value;
    item.append(name, value);
    const ratio = metric.value.match(/^\s*([\d,.]+)\s*\/\s*([\d,.]+)\s*$/);
    item.dataset["format"] = ratio ? "ratio" : /^\s*[\d,.]+\s*$/.test(metric.value) ? "number" : "text";
    if (ratio) {
      const current = Number(ratio[1]!.replaceAll(",", "")),
        total = Number(ratio[2]!.replaceAll(",", ""));
      if (Number.isFinite(current) && Number.isFinite(total) && total > 0) {
        const progress = document.createElement("progress");
        progress.className = "daily-progress";
        progress.max = total;
        progress.value = Math.min(current, total);
        progress.ariaLabel = `${metric.name}进度`;
        item.append(progress);
      }
    }
    return item;
  });
  container.replaceChildren(...children);
}

export function initializeDailyControls(): void {
  const notice = document.querySelector<HTMLElement>("#kuro-daily-notice")!;
  const refresh = document.querySelector<HTMLButtonElement>("#kuro-daily-refresh")!;
  const sync = document.querySelector<HTMLButtonElement>("#kuro-daily-sync")!;
  const local = document.querySelector<HTMLButtonElement>("#kuro-daily-local")!;
  const metrics = document.querySelector<HTMLElement>("#kuro-daily-metrics")!;
  const base = document.querySelector<HTMLElement>("#kuro-base-metrics")!;
  const boxes = document.querySelector<HTMLElement>("#kuro-box-metrics")!;
  let active = false;
  let generation = 0;
  let busy = false;
  async function load(force: boolean, synchronize = false, localOnly = false): Promise<void> {
    if (busy) return;
    busy = true;
    const current = ++generation;
    refresh.disabled = true;
    sync.disabled = true;
    local.disabled = true;
    notice.textContent = synchronize ? "正在同步游戏数据…" : "正在查询每日数据…";
    notice.dataset["kind"] = "info";
    try {
      const view = synchronize ? await window.syncKuroDaily() : await window.loadKuroDaily(force, localOnly);
      if (current !== generation) return;
      renderKuroMetrics(metrics, view.metrics);
      renderKuroMetrics(base, view.base);
      renderKuroMetrics(boxes, view.boxes);
      notice.textContent = `${view.cached ? "本地缓存 · " : ""}${view.roleName} · ${view.roleId}，查询时间 ${new Date(view.updatedAt).toLocaleString("zh-CN")}。`;
    } catch (error) {
      if (current !== generation) return;
      notice.dataset["kind"] = "error";
      notice.textContent = typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : "每日数据查询失败";
    } finally {
      if (current === generation) {
        busy = false;
        refresh.disabled = false;
        sync.disabled = false;
        local.disabled = false;
      }
    }
  }
  refresh.addEventListener("click", () => {
    void load(true);
  });
  sync.addEventListener("click", () => {
    void load(true, true);
  });
  local.addEventListener("click", () => {
    void load(false, false, true);
  });
  window.addEventListener("page-changed", (event) => {
    active = (event as CustomEvent<string>).detail === "daily";
    if (active) void load(false);
  });
  window.addEventListener("kuro-account-changed", () => {
    generation++;
    busy = false;
    refresh.disabled = false;
    sync.disabled = false;
    local.disabled = false;
    metrics.replaceChildren();
    base.replaceChildren();
    boxes.replaceChildren();
    notice.textContent = "角色已切换，进入本页后自动查询。";
    if (active) void load(false);
  });
}
