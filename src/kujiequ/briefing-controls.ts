import type { BriefingKind, BriefingPeriods, BriefingRecord, BriefingView } from "./briefing.ts";
import type { BriefingHistory } from "./briefing-history.ts";
import { gameIcon, gameImage } from "./game-images.ts";

const briefingChart = {
  left: 36,
  width: 568,
  top: 148,
  height: 112,
  baseline: 158,
  minimumValueSpan: 1,
  pointRadius: 3.5,
  coordinatePrecision: 1,
} as const;
const briefingBarMinimumLevel = 1;
const briefingBarMaximumLevel = 5;

function find<T extends HTMLElement>(id: string): T {
  return document.querySelector<T>(`#${id}`)!;
}
function errorMessage(error: unknown): string {
  return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : "资源简报查询失败，请刷新后重试";
}
function metric(name: string, value: string, resource = ""): HTMLElement {
  const item = document.createElement("article");
  item.className = "metric briefing-stat";
  const label = document.createElement("span");
  label.className = "briefing-stat-label";
  label.textContent = name;
  const image = gameImage("", "metric-game-icon", gameIcon(resource));
  if (image) {
    label.className += " metric-label";
    label.append(image);
  }
  const result = document.createElement("strong");
  result.className = "briefing-stat-value";
  result.textContent = value;
  item.append(label, result);
  return item;
}
function number(value: number): string {
  return value.toLocaleString("zh-CN");
}
function renderItems(body: HTMLTableSectionElement, items: BriefingRecord["coinItems"], tone: "star" | "coin"): void {
  const max = Math.max(1, ...items.map((item) => item.count));
  body.replaceChildren(
    ...items.map((item) => {
      const row = document.createElement("tr");
      const name = document.createElement("td");
      name.className = "briefing-source-name";
      name.textContent = item.kind;
      const count = document.createElement("td");
      count.className = "briefing-source-count";
      const bar = document.createElement("span");
      bar.className = `briefing-source-bar is-${tone}`;
      bar.dataset["level"] = `${item.count > 0 ? Math.max(briefingBarMinimumLevel, Math.min(briefingBarMaximumLevel, Math.ceil((item.count / max) * briefingBarMaximumLevel))) : 0}`;
      const value = document.createElement("strong");
      value.textContent = number(item.count);
      count.append(bar, value);
      row.append(name, count);
      return row;
    }),
  );
}
function changeCell(value: number | null): HTMLTableCellElement {
  const cell = document.createElement("td");
  cell.className = value === null ? "briefing-delta" : value > 0 ? "briefing-delta is-up" : value < 0 ? "briefing-delta is-down" : "briefing-delta";
  cell.textContent = value === null ? "-" : `${value > 0 ? "+" : ""}${value.toLocaleString("zh-CN")}`;
  return cell;
}

export function initializeBriefingControls(): void {
  const kind = find<HTMLSelectElement>("kuro-briefing-kind");
  const period = find<HTMLSelectElement>("kuro-briefing-period");
  const refresh = find<HTMLButtonElement>("kuro-briefing-refresh");
  const local = find<HTMLButtonElement>("kuro-briefing-local");
  const notice = find<HTMLElement>("kuro-briefing-notice");
  const metrics = find<HTMLElement>("kuro-briefing-metrics");
  const coins = find<HTMLTableSectionElement>("kuro-briefing-coins");
  const stars = find<HTMLTableSectionElement>("kuro-briefing-stars");
  const historyButton = find<HTMLButtonElement>("kuro-briefing-history"),
    syncHistory = find<HTMLButtonElement>("kuro-briefing-sync-history");
  const historyNotice = find<HTMLElement>("kuro-briefing-history-notice"),
    historyMetrics = find<HTMLElement>("kuro-briefing-history-metrics"),
    historyBody = find<HTMLTableSectionElement>("kuro-briefing-history-body");
  const chart = document.querySelector<SVGElement>("#kuro-briefing-chart")!,
    line = document.querySelector<SVGPolylineElement>("#kuro-briefing-line")!;
  const area = document.querySelector<SVGPathElement>("#kuro-briefing-area"),
    points = document.querySelector<SVGGElement>("#kuro-briefing-points");
  let periods: BriefingPeriods | null = null;
  let busy = false;
  let active = false;
  let generation = 0;
  let renderedKind = "";
  function itemsFor(): BriefingPeriods["weeks"] {
    return kind.value === "week" ? (periods?.weeks ?? []) : kind.value === "month" ? (periods?.months ?? []) : (periods?.versions ?? []);
  }
  function renderPeriods(): void {
    const items = itemsFor()
      .slice()
      .sort((left, right) => right.index.localeCompare(left.index, "en", { numeric: true }));
    const selected = renderedKind === kind.value ? period.value : "";
    period.replaceChildren(...items.map((item) => new Option(item.title, item.index)));
    if (items.some((item) => item.index === selected)) period.value = selected;
    renderedKind = kind.value;
    period.disabled = items.length === 0;
  }
  function clearRecord(): void {
    metrics.replaceChildren();
    coins.replaceChildren();
    stars.replaceChildren();
  }
  function setBusy(value: boolean): void {
    busy = value;
    refresh.disabled = value;
    local.disabled = value;
    kind.disabled = value;
    period.disabled = value || itemsFor().length === 0;
    historyButton.disabled = value;
    syncHistory.disabled = value;
  }
  function clearHistory(): void {
    historyMetrics.replaceChildren();
    historyBody.replaceChildren();
    chart.setAttribute("hidden", "");
    line.setAttribute("points", "");
    area?.setAttribute("d", "");
    points?.replaceChildren();
  }
  function renderHistory(history: BriefingHistory): void {
    historyMetrics.replaceChildren(metric("已保存周期", String(history.rows.length)), metric("累计星声", number(history.totalStar), "星声"), metric("累计贝币", number(history.totalCoin), "贝币"), metric("平均每期星声", history.averageStar.toFixed(1), "星声"));
    historyBody.replaceChildren(
      ...history.rows.map(({ view, starChange, coinChange }) => {
        const row = document.createElement("tr");
        const cycle = document.createElement("td");
        cycle.className = "briefing-period";
        cycle.textContent = view.period.title;
        const star = document.createElement("td");
        star.className = "briefing-number";
        star.textContent = number(view.record.totalStar);
        const coin = document.createElement("td");
        coin.className = "briefing-number";
        coin.textContent = number(view.record.totalCoin);
        const saved = document.createElement("td");
        saved.className = "briefing-time";
        saved.textContent = new Date(view.updatedAt).toLocaleString("zh-CN");
        row.append(cycle, star, changeCell(starChange), coin, changeCell(coinChange), saved);
        return row;
      }),
    );
    if (history.rows.length > 1) {
      const values = history.rows.map((row) => row.view.record.totalStar);
      const min = Math.min(...values),
        max = Math.max(...values),
        span = Math.max(briefingChart.minimumValueSpan, max - min);
      const segmentCount = values.length - 1;
      const coords = values.map((value, index) => ({
        x: briefingChart.left + (index * briefingChart.width) / segmentCount,
        y: briefingChart.top - ((value - min) / span) * briefingChart.height,
      }));
      line.setAttribute("points", coords.map((point) => `${point.x.toFixed(briefingChart.coordinatePrecision)},${point.y.toFixed(briefingChart.coordinatePrecision)}`).join(" "));
      area?.setAttribute("d", `M ${coords[0]!.x.toFixed(briefingChart.coordinatePrecision)} ${briefingChart.baseline} L ${coords.map((point) => `${point.x.toFixed(briefingChart.coordinatePrecision)} ${point.y.toFixed(briefingChart.coordinatePrecision)}`).join(" L ")} L ${coords[coords.length - 1]!.x.toFixed(briefingChart.coordinatePrecision)} ${briefingChart.baseline} Z`);
      if (points) {
        points.replaceChildren(
          ...coords.map((point) => {
            const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            circle.setAttribute("cx", point.x.toFixed(briefingChart.coordinatePrecision));
            circle.setAttribute("cy", point.y.toFixed(briefingChart.coordinatePrecision));
            circle.setAttribute("r", String(briefingChart.pointRadius));
            return circle;
          }),
        );
      }
      chart.setAttribute("aria-label", `已保存 ${history.rows.length} 个周期的星声趋势`);
      chart.removeAttribute("hidden");
    } else chart.setAttribute("hidden", "");
    historyNotice.textContent = history.rows.length ? `已读取 ${history.rows.length} 个${history.kind === "week" ? "周报" : history.kind === "month" ? "月报" : "版本"}周期，按索引排序；差值对应相邻已保存周期。` : "当前角色暂无本类历史，查询周期详情或补齐历史后可在此查看。";
    historyNotice.dataset["kind"] = "info";
  }
  async function loadHistory(synchronize = false): Promise<void> {
    if (busy) return;
    setBusy(true);
    const current = ++generation;
    historyNotice.textContent = synchronize ? "正在补齐尚未缓存的周期…" : "正在读取本地历史…";
    historyNotice.dataset["kind"] = "info";
    try {
      const history = await window.loadKuroBriefingHistory(kind.value as BriefingKind, synchronize);
      if (current === generation) renderHistory(history);
    } catch (error) {
      if (current === generation) {
        historyNotice.textContent = errorMessage(error);
        historyNotice.dataset["kind"] = "error";
      }
    } finally {
      if (current === generation) setBusy(false);
    }
  }
  function renderRecord(view: BriefingView): void {
    metrics.replaceChildren(metric("周期", view.period.title), metric("星声", number(view.record.totalStar), "星声"), metric("贝币", number(view.record.totalCoin), "贝币"), metric("明细", `${view.record.coinItems.length + view.record.starItems.length} 项`));
    renderItems(coins, view.record.coinItems, "coin");
    renderItems(stars, view.record.starItems, "star");
    notice.textContent = `${view.cached ? "本地缓存 · " : ""}${view.record.description || view.period.title} · 查询时间 ${new Date(view.updatedAt).toLocaleString("zh-CN")}`;
  }
  async function loadPeriods(force: boolean, localOnly = false): Promise<void> {
    if (busy) return;
    setBusy(true);
    const current = ++generation;
    notice.dataset["kind"] = "info";
    notice.textContent = "正在读取资源简报周期…";
    try {
      const next = await window.loadKuroBriefingPeriods(force, localOnly);
      if (current !== generation) return;
      periods = next;
      renderPeriods();
      period.disabled = true;
      await queryDetail(force, current);
    } catch (error) {
      if (current === generation) {
        notice.dataset["kind"] = "error";
        notice.textContent = errorMessage(error);
      }
    } finally {
      if (current === generation) setBusy(false);
    }
  }
  async function queryDetail(force: boolean, current: number): Promise<void> {
    clearRecord();
    if (!period.value) {
      notice.textContent = "当前账号暂无资源简报周期";
      return;
    }
    notice.dataset["kind"] = "info";
    notice.textContent = "正在查询资源简报…";
    const view = await window.loadKuroBriefingDetail(kind.value as BriefingKind, period.value, force, periods?.cached === true);
    if (current === generation) renderRecord(view);
  }
  async function loadDetail(): Promise<void> {
    if (busy) return;
    setBusy(true);
    const current = ++generation;
    try {
      await queryDetail(false, current);
    } catch (error) {
      if (current === generation) {
        notice.dataset["kind"] = "error";
        notice.textContent = errorMessage(error);
      }
    } finally {
      if (current === generation) setBusy(false);
    }
  }
  kind.addEventListener("change", () => {
    clearHistory();
    renderPeriods();
    void loadDetail();
  });
  period.addEventListener("change", () => {
    void loadDetail();
  });
  refresh.addEventListener("click", () => {
    void loadPeriods(true);
  });
  local.addEventListener("click", () => {
    void loadPeriods(false, true);
  });
  historyButton.addEventListener("click", () => {
    void loadHistory();
  });
  syncHistory.addEventListener("click", () => {
    void loadHistory(true);
  });
  window.addEventListener("briefing-history-progress", (event) => {
    if (!busy) return;
    const progress = (event as CustomEvent<{ completed: number; total: number }>).detail;
    historyNotice.textContent = `历史周期 ${progress.completed} / ${progress.total}，已完成的结果会保存在本地。`;
  });
  window.addEventListener("page-changed", (event) => {
    active = (event as CustomEvent<string>).detail === "briefing";
    if (active) void loadPeriods(false);
  });
  window.addEventListener("kuro-account-changed", () => {
    generation++;
    periods = null;
    renderedKind = "";
    period.replaceChildren();
    setBusy(false);
    clearRecord();
    clearHistory();
    historyNotice.textContent = "角色已切换，可读取当前角色的历史。";
    notice.textContent = "角色已切换，进入本页后自动查询。";
    if (active) void loadPeriods(false);
  });
}
