import type { ChallengeView, ChallengeRole, ChallengeBuff, NewTowerModeView, SlashDifficultyView, TowerAreaView } from "./challenge.ts";
import type { ChallengeSnapshot } from "./challenge-history.ts";
import { gameIcon, gameImage } from "./game-images.ts";

const challengeRoleIconSize = 24;

function find<T extends HTMLElement>(id: string): T {
  return document.querySelector<T>(`#${id}`)!;
}
function errorMessage(error: unknown): string {
  return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : "挑战数据查询失败，请刷新后重试";
}
function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}
function element(tag: string, className: string, value = ""): HTMLElement {
  const item = document.createElement(tag);
  item.className = className;
  item.textContent = value;
  return item;
}
interface ChallengePeriodContext {
  label: string;
  endTime: number;
  updatedAt: number;
}
function periodTime(timestamp: number): HTMLTimeElement {
  const time = document.createElement("time");
  if (timestamp > 0) {
    time.dateTime = new Date(timestamp).toISOString();
    time.textContent = new Date(timestamp).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  } else time.textContent = "未提供周期时间";
  return time;
}
function column(title: string, summary: string, period: ChallengePeriodContext, group: string): HTMLElement {
  const item = element("section", "challenge-column");
  const head = element("header", "challenge-column-head");
  head.append(element("h4", "", title), element("span", "challenge-column-summary", summary));
  const cycle = element("div", "challenge-column-period");
  cycle.append(element("span", "", group), element("span", "", "截至"), periodTime(period.endTime));
  item.append(head, cycle);
  return item;
}
function renderPeriod(kind: string, period: ChallengePeriodContext): void {
  const context = find<HTMLElement>(`kuro-${kind}-context`);
  const heading = element("div", "challenge-cycle-heading");
  const title = element("div", "challenge-cycle-title");
  title.append(element("span", "challenge-cycle-badge", period.label), element("span", "", "周期截止"), periodTime(period.endTime));
  const saved = element("span", "challenge-cycle-saved", period.updatedAt > 0 ? `记录于 ${formatEnd(period.updatedAt)}` : "原版导入记录");
  heading.append(title, saved);
  const guide = element("p", "challenge-grid-guide");
  const axes = kind === "tower" ? ["横向：塔区", "纵向：本期楼层与编队"] : kind === "slash" ? ["横向：难度", "纵向：本期关卡与半场"] : ["横向：模式", "纵向：本期队伍与战绩"];
  guide.append(...axes.map((value) => element("span", "", value)));
  context.replaceChildren(heading, guide);
}
function record(title: string, ...details: HTMLElement[]): HTMLElement {
  const item = element("article", "challenge-record");
  const head = element("div", "challenge-record-head");
  head.append(element("h5", "", title), ...details);
  item.append(head);
  return item;
}
function emptyRecord(container: HTMLElement, message: string): void {
  container.append(element("p", "challenge-empty", message));
}
function metric(name: string, value: string): HTMLElement {
  const item = document.createElement("article");
  item.className = "metric challenge-stat";
  const label = document.createElement("span");
  label.className = "challenge-stat-label";
  label.textContent = name;
  const result = document.createElement("strong");
  result.className = "challenge-stat-value";
  result.textContent = value;
  item.append(label, result);
  return item;
}
function formatEnd(timestamp: number): string {
  return timestamp > 0 ? new Date(timestamp).toLocaleString("zh-CN") : "未提供";
}
function appendTeam(row: HTMLElement, roles: ChallengeRole[] = [], fallbackCount = 0): void {
  const cell = document.createElement("div");
  cell.className = "challenge-team";
  if (!roles.length) {
    const empty = document.createElement("span");
    empty.className = "challenge-muted";
    empty.textContent = fallbackCount ? `${fallbackCount} 人队伍` : "暂无编队";
    cell.append(empty);
  }
  for (const role of roles) {
    const item = document.createElement("span");
    item.className = "challenge-role";
    const image = gameImage(role.iconUrl, "challenge-role-icon", gameIcon(role.name));
    if (image) {
      image.width = challengeRoleIconSize;
      image.height = challengeRoleIconSize;
      item.append(image);
    }
    const label = document.createElement("span");
    label.className = "challenge-role-name";
    label.textContent = role.name;
    item.append(label);
    if (role.skillBranch !== null) {
      const branch = document.createElement("span");
      branch.className = "challenge-role-branch";
      branch.textContent = `${role.skillBranch}`;
      item.append(branch);
    }
    cell.append(item);
  }
  row.append(cell);
}
function appendBuff(row: HTMLElement, buffs: ChallengeBuff[] = []): void {
  const cell = document.createElement("div");
  cell.className = "challenge-buffs";
  if (!buffs.length) {
    const empty = document.createElement("span");
    empty.className = "challenge-muted";
    empty.textContent = "暂无增益";
    cell.append(empty);
  }
  for (const buff of buffs) {
    const item = document.createElement("span");
    item.className = "challenge-buff";
    if (buff.description) item.title = buff.description;
    const image = gameImage(buff.iconUrl, "challenge-buff-icon");
    const name = document.createElement("span");
    name.className = "challenge-buff-name";
    name.textContent = buff.name || buff.id;
    const meta = document.createElement("span");
    meta.className = "challenge-buff-meta";
    meta.textContent = buff.quality ? `品质 ${buff.quality}` : "增益";
    if (image) item.append(image);
    item.append(name, meta);
    cell.append(item);
  }
  row.append(cell);
}
function rankTone(value: string): string {
  const rank = value.trim().toLowerCase();
  if (rank === "s" || rank === "ss" || rank === "sss") return "s";
  if (rank === "a" || rank === "b" || rank === "c") return rank;
  return "plain";
}
function rankBadge(value: string): HTMLElement {
  const cell = document.createElement("div");
  cell.className = "challenge-rank";
  const badge = document.createElement("span");
  badge.className = `challenge-rank-badge rank-${rankTone(value)}`;
  badge.textContent = value || "未评级";
  cell.append(badge);
  return cell;
}
function scoreValue(value: number): HTMLElement {
  const cell = document.createElement("div");
  cell.className = "challenge-score";
  const result = document.createElement("strong");
  result.textContent = formatNumber(value);
  cell.append(result);
  return cell;
}

function renderTower(view: ChallengeView, period: ChallengePeriodContext): void {
  const metrics = find<HTMLElement>("kuro-tower-metrics");
  const body = find<HTMLElement>("kuro-tower-body");
  metrics.replaceChildren(metric("状态", view.tower.unlocked ? "已解锁" : "未解锁"), metric("区域", `${view.tower.areas.length}`), metric("总星数", `${view.tower.areas.reduce((sum, area) => sum + area.stars, 0)}`), metric("截止时间", formatEnd(view.tower.seasonEndTime)));
  const towerPosition = (area: TowerAreaView): number => {
    if (/残响|殘響|Resonant/i.test(area.name)) return 0;
    if (/深境|Hazard/i.test(area.name)) return 1;
    if (/回音|Echoing/i.test(area.name)) return 2;
    return 3;
  };
  body.replaceChildren(...[...view.tower.areas].sort((a, b) => towerPosition(a) - towerPosition(b)).map((area) => {
    const item = column(area.name, `✦ ${area.stars} / ${area.maxStars}`, period, ["左塔", "中塔", "右塔"][towerPosition(area)] ?? "塔区");
    for (const floor of area.floors) {
      const row = record(`第 ${floor.floor} 层`, element("span", "challenge-stars", `${floor.stars}`));
      appendTeam(row, floor.roles, floor.roleCount);
      item.append(row);
    }
    if (!area.floors.length) emptyRecord(item, "暂无楼层记录");
    return item;
  }));
}

function renderSlash(view: ChallengeView, period: ChallengePeriodContext): void {
  const metrics = find<HTMLElement>("kuro-slash-metrics");
  const body = find<HTMLElement>("kuro-slash-body");
  const score = view.slash.difficulties.reduce((sum, difficulty) => sum + difficulty.score, 0);
  metrics.replaceChildren(metric("状态", view.slash.unlocked ? "已解锁" : "未解锁"), metric("难度", `${view.slash.difficulties.length}`), metric("总分", formatNumber(score)), metric("截止时间", formatEnd(view.slash.seasonEndTime)));
  body.replaceChildren(...view.slash.difficulties.map((difficulty: SlashDifficultyView) => {
    const item = column(difficulty.name, `${formatNumber(difficulty.score)}${difficulty.maxScore ? ` / ${formatNumber(difficulty.maxScore)}` : ""} 分`, period, "难度");
    for (const challenge of difficulty.challenges) {
      const row = record(challenge.name, scoreValue(challenge.score), rankBadge(challenge.rank));
      challenge.halves.forEach((half, index) => {
        const part = element("div", "challenge-part");
        part.append(element("p", "challenge-part-title", `第 ${index + 1} 半 · ${formatNumber(half.score)} 分`));
        appendTeam(part, half.roles, half.roleCount);
        appendBuff(part, half.buffs);
        row.append(part);
      });
      if (!challenge.halves.length) emptyRecord(row, "暂无半场记录");
      item.append(row);
    }
    if (!difficulty.challenges.length) emptyRecord(item, "暂无关卡记录");
    return item;
  }));
}

function renderNewTower(view: ChallengeView, period: ChallengePeriodContext): void {
  const metrics = find<HTMLElement>("kuro-new-tower-metrics");
  const body = find<HTMLElement>("kuro-new-tower-body");
  metrics.replaceChildren(metric("状态", view.newTower.unlocked ? "已解锁" : "未解锁"), metric("奖励", `${view.newTower.reward} / ${view.newTower.totalReward}`), metric("模式", `${view.newTower.modes.length}`), metric("截止时间", formatEnd(view.newTower.endTime)));
  body.replaceChildren(...view.newTower.modes.map((mode: NewTowerModeView) => {
    const item = column(`模式 ${mode.modeId}`, `${formatNumber(mode.score)} 分 · 排名 ${mode.rank || "—"}`, period, "模式");
    mode.teams.forEach((team, index) => {
      const row = record(`队伍 ${index + 1}`, scoreValue(team.score));
      row.append(element("p", "challenge-part-title", `首领 ${team.passBoss} / ${team.bossCount ?? mode.bossCount} · ${team.round} 轮`));
      appendTeam(row, team.roles, team.roleCount);
      appendBuff(row, team.buffs);
      item.append(row);
    });
    if (!mode.teams.length) {
      emptyRecord(item, `${mode.hasRecord ? "暂无队伍详情" : "暂无挑战记录"} · 首领 ${mode.passBoss} / ${mode.bossCount} · ${mode.round} 轮`);
    }
    return item;
  }));
}

export function initializeChallengeControls(): void {
  const refresh = find<HTMLButtonElement>("kuro-challenge-refresh");
  const notice = find<HTMLElement>("kuro-challenge-notice");
  const local = find<HTMLButtonElement>("kuro-challenge-local");
  const periods = ["tower", "slash", "new-tower"].map((kind) => ({
    kind,
    select: find<HTMLSelectElement>(`kuro-${kind}-period`),
  }));
  let currentView: ChallengeView | null = null;
  let history: ChallengeSnapshot[] = [];
  let busy = false;
  let active = false;
  let generation = 0;
  function emptyView(): ChallengeView {
    return {
      roleId: "",
      roleName: "",
      updatedAt: 0,
      tower: { unlocked: false, seasonEndTime: 0, areas: [] },
      slash: { unlocked: false, seasonEndTime: 0, difficulties: [] },
      newTower: {
        unlocked: false,
        endTime: 0,
        reward: 0,
        totalReward: 0,
        modes: [],
      },
    };
  }
  function renderSelection(kind: string, select: HTMLSelectElement): void {
    const saved = history.find((item) => item.id === select.value && item.kind === kind);
    const view = currentView ? { ...currentView } : emptyView();
    if (saved?.kind === "tower") view.tower = saved.data;
    if (saved?.kind === "slash") view.slash = saved.data;
    if (saved?.kind === "new-tower") view.newTower = saved.data;
    if (select.value !== "current" && !saved) {
      find<HTMLElement>(`kuro-${kind}-context`).replaceChildren();
      find<HTMLElement>(`kuro-${kind}-metrics`).replaceChildren();
      find<HTMLElement>(`kuro-${kind}-body`).replaceChildren();
      return;
    }
    const data = kind === "tower" ? view.tower : kind === "slash" ? view.slash : view.newTower;
    const period: ChallengePeriodContext = {
      label: saved ? (saved.updatedAt === 0 ? "原版导入" : "历史周期") : "当前周期",
      endTime: saved?.endTime ?? ("seasonEndTime" in data ? data.seasonEndTime : data.endTime),
      updatedAt: saved?.updatedAt ?? view.updatedAt,
    };
    renderPeriod(kind, period);
    if (kind === "tower") renderTower(view, period);
    else if (kind === "slash") renderSlash(view, period);
    else renderNewTower(view, period);
  }
  function renderPeriods(localOnly = false): void {
    for (const { kind, select } of periods) {
      const selected = select.value;
      select.replaceChildren(...(currentView ? [new Option("当前查询", "current")] : []), ...history.filter((item) => item.kind === kind).map((item) => new Option(`截止 ${formatEnd(item.endTime)} · ${item.updatedAt === 0 ? "原版导入" : `保存于 ${formatEnd(item.updatedAt)}`}`, item.id)));
      if (!localOnly && [...select.options].some((option) => option.value === selected)) select.value = selected;
      else if (localOnly) select.value = history.find((item) => item.kind === kind)?.id ?? "";
      select.disabled = busy || !select.options.length;
      renderSelection(kind, select);
    }
  }
  function setBusy(value: boolean): void {
    busy = value;
    refresh.disabled = value;
    local.disabled = value;
    for (const { select } of periods) select.disabled = value || !select.options.length;
  }
  for (const { kind, select } of periods) select.addEventListener("change", () => renderSelection(kind, select));
  async function load(force: boolean): Promise<void> {
    if (busy) return;
    setBusy(true);
    const current = ++generation;
    notice.dataset["kind"] = "info";
    notice.textContent = "正在查询挑战历史…";
    try {
      const view = await window.loadKuroChallenges(force);
      if (current !== generation) return;
      currentView = view;
      renderPeriods();
      notice.textContent = `${view.roleName} · 查询时间 ${new Date(view.updatedAt).toLocaleTimeString("zh-CN")}。`;
      try {
        const saved = await window.loadKuroChallengeHistory();
        if (current === generation) {
          history = saved;
          renderPeriods();
        }
      } catch {
        if (current === generation) notice.textContent += " 本地历史读取失败。";
      }
    } catch (error) {
      if (current === generation) {
        notice.dataset["kind"] = "error";
        notice.textContent = errorMessage(error);
        try {
          const saved = await window.loadKuroChallengeHistory();
          if (current === generation) {
            history = saved;
            renderPeriods(!currentView);
            if (history.length) notice.textContent += " 已载入本地历史。";
          }
        } catch {
          /* 保留当前查询失败的具体原因。 */
        }
      }
    } finally {
      if (current === generation) setBusy(false);
    }
  }
  local.addEventListener("click", async () => {
    if (busy) return;
    setBusy(true);
    const current = ++generation;
    try {
      const saved = await window.loadKuroChallengeHistory();
      if (current === generation) {
        history = saved;
        renderPeriods(true);
        notice.dataset["kind"] = "info";
        notice.textContent = history.length ? "已载入本地保存的挑战周期。" : "当前角色暂无本地挑战历史。";
      }
    } catch (error) {
      if (current === generation) {
        notice.dataset["kind"] = "error";
        notice.textContent = errorMessage(error);
      }
    } finally {
      if (current === generation) setBusy(false);
    }
  });
  refresh.addEventListener("click", () => {
    void load(true);
  });
  window.addEventListener("challenge-history-changed", () => {
    if (active) local.click();
  });
  window.addEventListener("page-changed", (event) => {
    active = (event as CustomEvent<string>).detail === "challenge";
    if (active) void load(false);
  });
  window.addEventListener("kuro-account-changed", () => {
    generation++;
    currentView = null;
    history = [];
    for (const { select } of periods) select.replaceChildren();
    setBusy(false);
    for (const id of ["kuro-tower-context", "kuro-slash-context", "kuro-new-tower-context", "kuro-tower-metrics", "kuro-tower-body", "kuro-slash-metrics", "kuro-slash-body", "kuro-new-tower-metrics", "kuro-new-tower-body"]) find<HTMLElement>(id).replaceChildren();
    notice.textContent = "角色已切换，进入本页后自动查询。";
    if (active) void load(false);
  });
}
