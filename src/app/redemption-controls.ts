import type { RedemptionCodes } from "./redemption-codes.ts";
import { appErrorMessage } from "./error-message.ts";

const redemptionTableColumnCount = 7;

export function initializeRedemptionControls(): void {
  const find = <T extends HTMLElement>(id: string): T => document.querySelector<T>(`#${id}`)!;
  const expired = find<HTMLInputElement>("redemption-expired"),
    refresh = find<HTMLButtonElement>("redemption-refresh"),
    local = find<HTMLButtonElement>("redemption-local");
  const body = find<HTMLTableSectionElement>("redemption-body"),
    notice = find<HTMLElement>("redemption-notice");
  let view: RedemptionCodes | null = null;
  let busy = false;
  function render(): void {
    const items = view?.codes ?? [];
    body.replaceChildren(
      ...items
        .filter((item) => expired.checked || item.valid)
        .map((item) => {
          const row = document.createElement("tr");
          for (const value of [item.key, item.reward || item.description, item.valid ? "有效" : "已失效", item.startTime || "-", item.endTime || "-", item.contributors || "-"]) {
            const cell = document.createElement("td");
            cell.textContent = value;
            if (value === item.contributors && item.sourceUrl) cell.title = item.sourceUrl;
            row.append(cell);
          }
          const cell = document.createElement("td"),
            copy = document.createElement("button");
          copy.type = "button";
          copy.className = "secondary-button";
          copy.textContent = "复制";
          copy.addEventListener("click", async () => {
            copy.disabled = true;
            try {
              await window.copyText(item.key);
              notice.textContent = `已复制 ${item.key}，请在游戏内兑换。`;
              notice.dataset["kind"] = "info";
            } catch {
              notice.textContent = "复制失败，可选中兑换码文本手动复制。";
              notice.dataset["kind"] = "error";
            } finally {
              copy.disabled = false;
            }
          });
          cell.append(copy);
          row.append(cell);
          return row;
        }),
    );
    if (view && !body.children.length) {
      const row = document.createElement("tr"),
        cell = document.createElement("td");
      cell.colSpan = redemptionTableColumnCount;
      cell.className = "empty-state";
      cell.textContent = items.length ? "当前没有有效兑换码，可勾选“显示失效”查看历史记录。" : "game-cal 暂未提供兑换码，可稍后刷新。";
      row.append(cell);
      body.append(row);
    }
    if (view) notice.textContent = `game-cal · ${view.cached ? "本地缓存 · " : ""}更新于 ${new Date(view.updatedAt).toLocaleString("zh-CN")} · ${items.filter((item) => item.valid).length} 个有效兑换码。${view.notice ?? ""}`;
  }
  async function load(force: boolean, localOnly = false): Promise<void> {
    if (busy) return;
    busy = true;
    refresh.disabled = true;
    local.disabled = true;
    notice.textContent = "正在读取兑换码…";
    notice.dataset["kind"] = "info";
    try {
      view = await window.loadRedemptionCodes(force, localOnly);
      render();
    } catch (error) {
      notice.textContent = appErrorMessage(error, "读取兑换码失败");
      notice.dataset["kind"] = "error";
    } finally {
      busy = false;
      refresh.disabled = false;
      local.disabled = false;
    }
  }
  refresh.addEventListener("click", () => {
    void load(true);
  });
  local.addEventListener("click", () => {
    void load(false, true);
  });
  expired.addEventListener("change", render);
  window.addEventListener("page-changed", (event) => {
    if ((event as CustomEvent<string>).detail === "redemption") void load(false);
  });
}
