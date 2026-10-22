import type { GachaPoolHistory } from "./history.ts";
import type { GachaRecord } from "./model.ts";
import { gachaPool } from "./pools.ts";
import { itemLabel } from "../kujiequ/game-images.ts";

const overviewFiveStarLimit = 4;

const date = (value: string): string =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(new Date(value));

export function renderGachaOverview(groups: readonly GachaPoolHistory[], records: readonly GachaRecord[], selectHistory: (key: string) => void): void {
  const container = document.querySelector<HTMLElement>("#gacha-pool-cards")!;
  const recordsByPool = new Map<string, GachaRecord[]>();
  for (const record of records) {
    const key = JSON.stringify([record.playerId, gachaPool(record).key]);
    const items = recordsByPool.get(key) ?? [];
    items.push(record);
    recordsByPool.set(key, items);
  }
  const cards = groups.map((group) => {
    const poolRecords = recordsByPool.get(group.key)!;
    const pool = gachaPool(poolRecords[0]!);
    const card = document.createElement("article");
    card.className = "gacha-pool-card";
    card.dataset["tone"] = pool.kind === "weapon" ? (pool.name.includes("常驻") ? "mint" : "blue") : pool.name.includes("常驻") ? "violet" : "amber";
    const header = document.createElement("header");
    const title = document.createElement("h3");
    title.textContent = group.poolName;
    const player = document.createElement("small");
    player.textContent = `玩家 ${group.playerId}`;
    header.append(title, player);

    const pity = document.createElement("div");
    pity.className = "pool-pity";
    const label = document.createElement("span");
    label.textContent = group.hasFiveStar ? "距上次五星已垫" : "已记录未出五星";
    const value = document.createElement("strong");
    value.textContent = String(group.currentFiveStarPity);
    const unit = document.createElement("small");
    unit.textContent = "抽";
    pity.append(label, value, unit);

    const stats = document.createElement("dl");
    stats.className = "pool-stats";
    for (const [name, count] of [
      ["累计唤取", group.totalPulls.toLocaleString()],
      ["五星获得", `${group.fiveStars.length} 个`],
      ["五星平均", group.completedAverage === null ? "暂无" : `${group.completedAverage.toFixed(1)} 抽`],
      ["四星及以上已垫", `${group.currentFourStarPity} 抽`],
    ]) {
      const label = document.createElement("dt"),
        value = document.createElement("dd");
      label.textContent = name!;
      value.textContent = count!;
      stats.append(label, value);
    }
    const recentTitle = document.createElement("h4");
    recentTitle.textContent = "最近五星";
    const recent = document.createElement("ul");
    recent.className = "pool-recent";
    for (const item of group.fiveStars.slice(0, overviewFiveStarLimit)) {
      const row = document.createElement("li");
      const copy = document.createElement("div"),
        name = document.createElement("strong"),
        time = document.createElement("time");
      name.append(itemLabel(item.name, "", item.resourceId));
      time.textContent = date(item.time);
      time.dateTime = item.time;
      copy.append(name, time);
      const count = document.createElement("span");
      count.className = "pull-count";
      count.textContent = `${item.complete ? "" : "≥ "}${item.pulls} 抽`;
      count.title = item.complete ? "两个五星之间的完整区间" : "记录起点至首个五星，实际区间可能更长";
      row.append(copy, count);
      recent.append(row);
    }
    if (!group.fiveStars.length) {
      const empty = document.createElement("li");
      empty.className = "pool-empty";
      empty.textContent = "暂无五星记录。";
      recent.append(empty);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pool-history-button";
    button.textContent = "查看五星历史";
    button.setAttribute("aria-label", `查看玩家 ${group.playerId} 的${group.poolName}五星历史`);
    button.addEventListener("click", () => selectHistory(group.key));
    card.append(header, pity, stats, recentTitle, recent, button);
    return card;
  });
  if (!cards.length) {
    const empty = document.createElement("div");
    empty.className = "gacha-empty";
    const title = document.createElement("h3"),
      copy = document.createElement("p"),
      button = document.createElement("button");
    title.textContent = "暂无抽卡记录";
    copy.textContent = "查询游戏记录或导入文件，查看各卡池的唤取进度。";
    button.type = "button";
    button.className = "primary-button";
    button.textContent = "添加抽卡记录";
    button.addEventListener("click", () => {
      document.querySelector<HTMLDetailsElement>("#gacha-import")!.open = true;
      document.querySelector<HTMLInputElement>("#gacha-link")!.focus();
    });
    empty.append(title, copy, button);
    container.replaceChildren(empty);
  } else container.replaceChildren(...cards);
}
