import { buildGachaHistory, type GachaPoolHistory } from "./history.ts";
import { itemLabel } from "../kujiequ/game-images.ts";
import type { GachaRecord } from "./model.ts";
import { renderGachaOverview } from "./overview-controls.ts";
import { gachaHistoryColumnIndex, gachaHistoryPageSize, gachaHistoryTabIndex } from "./constants.ts";

export function initializeGachaHistory(): (records: readonly GachaRecord[]) => void {
  const find = <T extends HTMLElement>(id: string): T => document.querySelector<T>(`#${id}`)!;
  const pool = find<HTMLSelectElement>("gacha-history-pool");
  const metrics = find<HTMLElement>("gacha-history-summary");
  const body = find<HTMLTableSectionElement>("gacha-history-body");
  const previous = find<HTMLButtonElement>("gacha-history-previous");
  const next = find<HTMLButtonElement>("gacha-history-next");
  const pageNotice = find<HTMLElement>("gacha-history-page");
  let groups: GachaPoolHistory[] = [];
  let page = 0;
  const pageSize = gachaHistoryPageSize;
  const tabs = ["overview", "history", "records"].map((name) => ({
    tab: find<HTMLButtonElement>(`gacha-${name}-tab`),
    panel: find<HTMLElement>(`gacha-${name}`),
  }));
  function selectView(index: number, focus = false): void {
    tabs.forEach((item, current) => {
      item.tab.setAttribute("aria-selected", String(current === index));
      item.tab.tabIndex = current === index ? 0 : -1;
      item.panel.hidden = current !== index;
    });
    if (focus) tabs[index]!.tab.focus();
  }
  tabs.forEach((item, index) => {
    item.tab.addEventListener("click", () => selectView(index));
    item.tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      selectView(next, true);
    });
  });
  function render(): void {
    const group = groups.find((item) => item.key === pool.value);
    const total = group?.fiveStars.length ?? 0;
    find<HTMLElement>("gacha-history-empty").hidden = total > 0;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    page = Math.min(page, pages - 1);
    metrics.textContent = group ? `总抽数 ${group.totalPulls} · ${group.hasFiveStar ? "距上次五星" : "已记录未出五星"} ${group.currentFiveStarPity} 抽 · 距上次四星及以上 ${group.currentFourStarPity} 抽 · 完整五星间隔平均 ${group.completedAverage?.toFixed(1) ?? "暂无"}` : "暂无记录";
    body.replaceChildren(
      ...(group?.fiveStars ?? []).slice(page * pageSize, (page + 1) * pageSize).map((item) => {
        const row = document.createElement("tr");
        const time = new Intl.DateTimeFormat("zh-CN", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(item.time));
        for (const [index, value] of [time, item.name, String(item.pulls), item.complete ? "完整区间" : "记录起点至首个五星", item.gachaName].entries()) {
          const cell = document.createElement("td");
          if (index === gachaHistoryColumnIndex.name) cell.className = "five-star-name";
          if (index === gachaHistoryColumnIndex.pulls) {
            const count = document.createElement("span");
            count.className = "pull-count";
            count.textContent = value!;
            cell.append(count);
          } else if (index === gachaHistoryColumnIndex.name) cell.append(itemLabel(item.name, "", item.resourceId));
          else cell.textContent = value!;
          row.append(cell);
        }
        return row;
      }),
    );
    pageNotice.textContent = `第 ${page + 1} / ${pages} 页 · ${total} 个五星`;
    previous.disabled = page === 0;
    next.disabled = page >= pages - 1;
    pool.disabled = !groups.length;
  }
  pool.addEventListener("change", () => {
    page = 0;
    render();
  });
  previous.addEventListener("click", () => {
    if (page > 0) {
      page--;
      render();
    }
  });
  next.addEventListener("click", () => {
    if (page + 1 < Math.ceil((groups.find((item) => item.key === pool.value)?.fiveStars.length ?? 0) / pageSize)) {
      page++;
      render();
    }
  });
  return (records) => {
    const selected = pool.value;
    groups = buildGachaHistory(records);
    page = 0;
    renderGachaOverview(groups, records, (key) => {
      pool.value = key;
      page = 0;
      render();
      selectView(gachaHistoryTabIndex.history);
      tabs[gachaHistoryTabIndex.history]!.tab.focus({ preventScroll: true });
      document.querySelector<HTMLElement>(".gacha-view-bar")!.scrollIntoView({ block: "start", behavior: "instant" });
    });
    pool.replaceChildren(...groups.map((group) => new Option(`${group.playerId} · ${group.poolName}`, group.key)));
    if (groups.some((group) => group.key === selected)) pool.value = selected;
    render();
  };
}
