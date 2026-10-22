import type { GachaRecord } from "./model.ts";
import type { GachaProgress } from "./online.ts";

export function initializeOnlineGacha(onRecords: (records: GachaRecord[]) => Promise<void>): void {
  const form = document.querySelector<HTMLFormElement>("#online-gacha-form")!;
  const input = document.querySelector<HTMLInputElement>("#gacha-link")!;
  const button = document.querySelector<HTMLButtonElement>("#query-gacha")!;
  const notice = document.querySelector<HTMLElement>("#gacha-query-notice")!;
  const pickLog = document.querySelector<HTMLButtonElement>("#pick-gacha-log");
  const importPanel = document.querySelector<HTMLDetailsElement>("#gacha-import");
  const importToggle = document.querySelector<HTMLButtonElement>("#gacha-import-toggle");
  importToggle?.addEventListener("click", () => {
    if (importPanel) importPanel.open = !importPanel.open;
  });
  importPanel?.addEventListener("toggle", () => importToggle?.setAttribute("aria-expanded", String(importPanel.open)));
  let busy = false;
  window.addEventListener("gacha-query-progress", (event) => {
    if (!busy) return;
    const progress = (event as CustomEvent<GachaProgress>).detail;
    notice.textContent = `正在查询卡池：${progress.completedPools} / ${progress.totalPools}`;
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !input.value.trim()) return;
    busy = true;
    button.disabled = true;
    const link = input.value;
    input.value = "";
    notice.dataset["kind"] = "info";
    notice.textContent = "正在查询官方抽卡记录…";
    try {
      const result = await window.queryGachaRecords(link);
      await onRecords(result.records);
      notice.textContent = `查询完成：新增 ${result.addedCount} 条，跳过重复 ${result.duplicateCount} 条`;
    } catch (error) {
      notice.dataset["kind"] = "error";
      notice.textContent = typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : "查询失败，请重新获取游戏抽卡链接";
    } finally {
      busy = false;
      button.disabled = false;
    }
  });
  pickLog?.addEventListener("click", async () => {
    if (busy) return;
    pickLog.disabled = true;
    notice.dataset["kind"] = "info";
    notice.textContent = "请选择游戏 Client.log…";
    try {
      const path = await window.pickGachaLogFile();
      if (!path) {
        notice.textContent = "已取消选择日志文件。";
        return;
      }
      input.value = await window.extractGachaLinkFromLog(path);
      notice.textContent = "已提取最新抽卡链接，点击“查询官方记录”继续。";
    } catch (error) {
      notice.dataset["kind"] = "error";
      notice.textContent = typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : "提取抽卡链接失败";
    } finally {
      pickLog.disabled = false;
    }
  });
}
