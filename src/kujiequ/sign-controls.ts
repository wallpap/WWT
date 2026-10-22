import type { SignTarget, SignView } from "./sign.ts";
import type { SignRecord } from "./sign-store.ts";
import type { AutoSignStatus } from "./auto-sign.ts";
import { appErrorMessage } from "../app/error-message.ts";
import { gameIcon, gameImage, itemLabel } from "./game-images.ts";

type SignReward = SignView["rewards"][number];
function renderRewards(container: HTMLElement, items: SignReward[], signDays?: number, signed?: boolean): void {
  const today = signDays === undefined ? -1 : signed ? signDays - 1 : signDays;
  container.replaceChildren(
    ...items.map((item, index) => {
      const isToday = index === today && index >= 0 && index < items.length;
      const card = document.createElement("article");
      card.className = ["sign-reward", item.received ? "is-received" : "", isToday ? "is-today" : ""].filter(Boolean).join(" ");
      const day = document.createElement("span");
      day.className = "sign-reward-day";
      day.textContent = `第 ${index + 1} 天`;
      const name = document.createElement("strong");
      name.className = "sign-reward-name";
      name.textContent = item.name;
      const count = document.createElement("span");
      count.className = "sign-reward-count";
      count.textContent = `× ${item.count}`;
      const state = document.createElement("span");
      state.className = "sign-reward-state";
      state.textContent = item.received ? "已领取" : isToday ? "今日可领" : "未领取";
      card.append(day);
      const image = gameImage(item.iconUrl ?? "", "sign-reward-icon", gameIcon(item.name));
      if (image) card.append(image);
      card.append(name, count, state);
      return card;
    }),
  );
}

export function initializeSignControls(): void {
  const find = <T extends HTMLElement>(id: string) => document.querySelector<T>(`#${id}`)!;
  const notice = find<HTMLElement>("kuro-sign-notice");
  const refresh = find<HTMLButtonElement>("kuro-sign-refresh");
  const local = find<HTMLButtonElement>("kuro-sign-local");
  const submit = find<HTMLButtonElement>("kuro-sign-submit");
  const rewards = find<HTMLElement>("kuro-sign-rewards");
  const body = find<HTMLTableSectionElement>("kuro-sign-history");
  const batchPreview = find<HTMLButtonElement>("kuro-sign-batch-preview");
  const batchSubmit = find<HTMLButtonElement>("kuro-sign-batch-submit");
  const batchNotice = find<HTMLElement>("kuro-sign-batch-notice");
  const auto = find<HTMLInputElement>("kuro-sign-auto"),
    autoNotice = find<HTMLElement>("kuro-sign-auto-notice");
  let autoSaving = false;
  function renderAuto(status: AutoSignStatus): void {
    if (!autoSaving) auto.checked = status.enabled;
    const results = status.results.map((item) => `${item.target.roleName} · ${item.target.roleId}：${item.error ?? item.result?.message}`).join("；");
    autoNotice.textContent = status.running ? "正在为全部账号角色自动签到…" : (status.error ?? (status.enabled ? `自动签到已启用，助手需保持运行。下次每日计划：${status.nextRun ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short" }).format(new Date(status.nextRun)) : "等待账号"}（北京时间）。${results}` : "自动签到已关闭。"));
    autoNotice.dataset["kind"] = status.error || status.results.some((item) => item.error) ? "error" : "info";
  }
  async function restoreAuto(): Promise<void> {
    if (autoSaving) return;
    try {
      renderAuto(await window.loadAutoSignStatus());
    } catch (error) {
      autoNotice.textContent = appErrorMessage(error, "读取自动签到设置失败");
    }
  }
  auto.addEventListener("change", async () => {
    if (autoSaving) return;
    autoSaving = true;
    auto.disabled = true;
    let failure: string | null = null;
    try {
      await window.updateAppSettings({ autoSign: auto.checked });
      window.dispatchEvent(new Event("app-settings-changed"));
    } catch (error) {
      failure = appErrorMessage(error, "保存自动签到设置失败");
    } finally {
      autoSaving = false;
      auto.disabled = false;
      await restoreAuto();
      if (failure) {
        autoNotice.textContent = failure;
        autoNotice.dataset["kind"] = "error";
      }
    }
  });
  window.addEventListener("auto-sign-changed", (event) => {
    const status = (event as CustomEvent<AutoSignStatus>).detail;
    renderAuto(status);
    if (!status.running && status.lastRun && !busy && !batchBusy) {
      current = null;
      submit.disabled = true;
      if (active) notice.textContent = "自动签到已完成，刷新状态可查看当前角色。";
    }
  });
  window.addEventListener("app-settings-changed", () => {
    void restoreAuto();
  });
  void restoreAuto();
  let targets: SignTarget[] = [];
  let batchBusy = false;
  let active = false;
  let generation = 0;
  let busy = false;
  let current: SignView | null = null;
  function render(view: SignView): void {
    current = view;
    notice.textContent = `${view.cached ? "今日缓存 · " : ""}${view.roleName} · ${view.roleId}，本月已签 ${view.signDays} 天，${view.signed ? "今日已签到" : "今日未签到"}。`;
    submit.disabled = view.signed;
    renderRewards(rewards, view.rewards, view.signDays, view.signed);
    renderHistory(view.history);
  }
  function renderHistory(history: SignRecord[]): void {
    const rows = history.map((record) => {
      const row = document.createElement("tr");
      const date = document.createElement("td");
      date.className = "sign-history-date";
      date.textContent = record.date;
      const name = document.createElement("td");
      name.className = "sign-history-name";
      name.append(itemLabel(record.name, record.iconUrl ?? ""));
      const count = document.createElement("td");
      count.className = "sign-history-count";
      count.textContent = record.count;
      row.append(date, name, count);
      return row;
    });
    body.replaceChildren(...rows);
  }
  async function run(sign: boolean, force = false): Promise<void> {
    if (busy || batchBusy || (sign && (!current || current.signed))) return;
    const target = current;
    busy = true;
    refresh.disabled = true;
    local.disabled = true;
    submit.disabled = true;
    const version = ++generation;
    notice.dataset["kind"] = "info";
    notice.textContent = sign ? `正在为 ${target!.roleName} · ${target!.roleId} 签到…` : "正在查询签到状态与奖励历史…";
    try {
      if (sign) {
        const result = await window.submitKuroSign(target!.accountId, target!.roleId, target!.serverId);
        if (version !== generation) return;
        if (result.view) render(result.view);
        else current = null;
        notice.textContent = `${result.message}${result.view ? `，本月已签 ${result.view.signDays} 天。` : ""}`;
      } else {
        const view = await window.loadKuroSign(force);
        if (version !== generation) return;
        render(view);
      }
    } catch (error) {
      if (version !== generation) return;
      current = null;
      notice.dataset["kind"] = "error";
      notice.textContent = typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : "签到操作失败，请刷新状态";
    } finally {
      if (version === generation) {
        busy = false;
        refresh.disabled = false;
        local.disabled = false;
        submit.disabled = !current || current.signed;
      }
    }
  }
  async function loadLocal(): Promise<void> {
    if (busy || batchBusy) return;
    busy = true;
    refresh.disabled = true;
    local.disabled = true;
    submit.disabled = true;
    current = null;
    const version = ++generation;
    rewards.replaceChildren();
    body.replaceChildren();
    notice.dataset["kind"] = "info";
    notice.textContent = "正在读取本地签到历史…";
    try {
      const saved = await window.loadLocalKuroSignHistory();
      if (version !== generation) return;
      renderHistory(saved.history);
      renderRewards(rewards, saved.rewards ?? []);
      notice.textContent = `${saved.roleName} · 本地签到历史 ${saved.history.length} 条。刷新状态后可签到。`;
    } catch (error) {
      if (version === generation) {
        notice.dataset["kind"] = "error";
        notice.textContent = error instanceof Error ? error.message : "本地签到历史读取失败";
      }
    } finally {
      if (version === generation) {
        busy = false;
        refresh.disabled = false;
        local.disabled = false;
      }
    }
  }
  local.addEventListener("click", loadLocal);
  window.addEventListener("sign-history-changed", () => {
    if (active) void loadLocal();
  });
  refresh.addEventListener("click", () => {
    void run(false, true);
  });
  submit.addEventListener("click", () => {
    void run(true);
  });
  async function batch(execute: boolean): Promise<void> {
    if (batchBusy || busy || (execute && !targets.length)) return;
    batchBusy = true;
    batchPreview.disabled = true;
    batchSubmit.disabled = true;
    submit.disabled = true;
    refresh.disabled = true;
    local.disabled = true;
    const version = generation;
    try {
      if (execute) {
        const planned = targets;
        targets = [];
        batchSubmit.hidden = true;
        batchNotice.textContent = `正在依次为 ${planned.length} 个角色签到…`;
        const results = await window.submitKuroBatchSign(planned);
        if (version !== generation) return;
        batchNotice.textContent = results.map((item) => `${item.target.roleName} · ${item.target.roleId}：${item.error ?? item.result?.message}`).join("；");
        current = null;
        notice.textContent = "批量签到完成，点击刷新状态查看当前角色。";
      } else {
        const values = await window.previewKuroBatchSign();
        if (version !== generation) return;
        targets = values;
        batchNotice.textContent = targets.length ? `将为以下 ${targets.length} 个角色签到：${targets.map((item) => `${item.roleName} · ${item.roleId}`).join("；")}` : "请先登录并绑定角色。";
        batchSubmit.hidden = !targets.length;
      }
    } catch (error) {
      if (version !== generation) return;
      targets = [];
      batchSubmit.hidden = true;
      batchNotice.textContent = typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : "批量签到失败，请刷新状态";
    } finally {
      batchBusy = false;
      batchPreview.disabled = false;
      batchSubmit.disabled = false;
      if (version === generation) {
        submit.disabled = !current || current.signed;
        refresh.disabled = false;
        local.disabled = false;
      }
    }
  }
  batchPreview.addEventListener("click", () => {
    void batch(false);
  });
  batchSubmit.addEventListener("click", () => {
    void batch(true);
  });
  window.addEventListener("page-changed", (event) => {
    active = (event as CustomEvent<string>).detail === "sign";
    if (active) void run(false);
  });
  window.addEventListener("kuro-account-changed", () => {
    generation++;
    current = null;
    busy = false;
    submit.disabled = true;
    refresh.disabled = false;
    local.disabled = false;
    targets = [];
    batchSubmit.hidden = true;
    batchNotice.textContent = "";
    rewards.replaceChildren();
    body.replaceChildren();
    notice.textContent = "角色已切换，进入本页后自动查询。";
    if (active) void run(false);
  });
}
