import type { GameTimeRecord } from "./model.ts";
import { filterGameTime, gameTimeOverview } from "./overview.ts";
import { millisecondsPerMinute, minutesPerHour } from "../units.ts";
import { appErrorMessage as errorMessage } from "../app/error-message.ts";

const gameTimeColumnCount = 6;
const gameTimeFormatter = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" });

export function initializeGameTimeControls(): void {
  const query = <ElementType extends Element>(selector: string): ElementType => {
    const element = document.querySelector<ElementType>(selector);
    if (!element) throw new Error(`界面缺少元素：${selector}`);
    return element;
  };

  const gamePath = query<HTMLInputElement>("#game-path");
  const gameTimeForm = query<HTMLFormElement>("#game-time-form");
  const gameTimeRole = query<HTMLInputElement>("#time-role");
  const gameTimeDate = query<HTMLInputElement>("#time-date");
  const gameTimeStart = query<HTMLInputElement>("#time-start");
  const gameTimeEnd = query<HTMLInputElement>("#time-end");
  const gameTimeNotice = query<HTMLElement>("#game-time-notice");
  const gameTimeBody = query<HTMLTableSectionElement>("#game-time-body");
  const gameTimeToday = query<HTMLElement>("#time-today");
  const gameTimeTotal = query<HTMLElement>("#time-total");
  const gameTimeCount = query<HTMLElement>("#time-count");
  const scanGameLogsButton = query<HTMLButtonElement>("#scan-game-logs");
  const timePlayerFilter = query<HTMLSelectElement>("#time-player-filter"),
    timeFilterStart = query<HTMLInputElement>("#time-filter-start"),
    timeFilterEnd = query<HTMLInputElement>("#time-filter-end");

  let allGameTime: GameTimeRecord[] = [];

  function localDate(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  function formatDuration(milliseconds: number): string {
    const minutes = Math.floor(Math.max(0, milliseconds) / millisecondsPerMinute);
    return `${Math.floor(minutes / minutesPerHour)}小时${String(minutes % minutesPerHour).padStart(2, "0")}分钟`;
  }

  function renderDuration(element: HTMLElement, milliseconds: number): void {
    const minutes = Math.floor(Math.max(0, milliseconds) / millisecondsPerMinute);
    const parts = [String(Math.floor(minutes / minutesPerHour)), "小时", String(minutes % minutesPerHour).padStart(2, "0"), "分钟"];
    element.replaceChildren(
      ...parts.map((part, index) => {
        const span = document.createElement("span");
        span.className = index % 2 === 0 ? "duration-number" : "duration-unit";
        span.textContent = part;
        return span;
      }),
    );
  }

  function renderGameTime(): void {
    const selected = timePlayerFilter.value;
    const players = [...new Set(allGameTime.flatMap((record) => (record.roleId ? [record.roleId] : [])))].sort();
    timePlayerFilter.replaceChildren(new Option("全部玩家", ""), ...players.map((player) => new Option(player, player)), ...(allGameTime.some((record) => record.roleId === null) ? [new Option("未填写玩家", "unassigned")] : []));
    if ((selected === "unassigned" && allGameTime.some((record) => record.roleId === null)) || players.includes(selected)) timePlayerFilter.value = selected;
    const records = filterGameTime(allGameTime, {
      roleId: timePlayerFilter.value,
      start: timeFilterStart.value,
      end: timeFilterEnd.value,
    });
    const summary = gameTimeOverview(records, localDate());
    renderDuration(gameTimeToday, summary.todayDuration);
    renderDuration(gameTimeTotal, summary.totalDuration);
    gameTimeCount.textContent = `${summary.recordCount} 条记录 · ${summary.activeDays} 个活跃日`;
    renderDuration(query<HTMLElement>("#time-week"), summary.weekDuration);
    renderDuration(query<HTMLElement>("#time-month"), summary.monthDuration);
    renderDuration(query<HTMLElement>("#time-average"), summary.averageActiveDay);
    renderDuration(query<HTMLElement>("#time-longest"), summary.longestDay);
    query<HTMLTableSectionElement>("#time-daily-body").replaceChildren(
      ...summary.days
        .slice()
        .reverse()
        .map(([date, duration]) => {
          const row = document.createElement("tr");
          for (const value of [date, formatDuration(duration)]) {
            const cell = document.createElement("td");
            cell.textContent = value;
            row.append(cell);
          }
          return row;
        }),
    );
    if (timeFilterStart.value && timeFilterEnd.value && timeFilterStart.value > timeFilterEnd.value) {
      gameTimeNotice.textContent = "开始日期应早于或等于结束日期。";
      gameTimeNotice.dataset["kind"] = "error";
    }
    const rows = [...records]
      .sort((left, right) => right.startTime - left.startTime)
      .map((record) => {
        const row = document.createElement("tr");
        const values = [
          record.gameDate,
          record.roleId ?? "未填写",
          gameTimeFormatter.format(new Date(record.startTime)),
          gameTimeFormatter.format(new Date(record.endTime)),
          formatDuration(record.duration),
        ];
        for (const value of values) {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.append(cell);
        }
        const actionCell = document.createElement("td");
        const button = document.createElement("button");
        button.className = "text-button";
        button.type = "button";
        button.textContent = "删除";
        button.addEventListener("click", async () => {
          if (record.id === undefined) return;
          allGameTime = await window.deleteGameTime(record.id);
          renderGameTime();
        });
        actionCell.append(button);
        row.append(actionCell);
        return row;
      });
    if (rows.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.className = "empty-state";
      cell.colSpan = gameTimeColumnCount;
      cell.textContent = allGameTime.length > 0 ? "当前筛选范围内暂无记录，可调整玩家或日期。" : "暂无游戏时长记录。通过助手启动游戏可自动记录，也可扫描游戏日志补充。";
      row.append(cell);
      rows.push(row);
    }
    gameTimeBody.replaceChildren(...rows);
  }

  for (const control of [timePlayerFilter, timeFilterStart, timeFilterEnd]) control.addEventListener("change", renderGameTime);

  gameTimeDate.value = localDate();
  window.addEventListener("game-time-error", (event) => {
    gameTimeNotice.textContent = (event as CustomEvent<string>).detail;
    gameTimeNotice.dataset["kind"] = "error";
  });
  window.addEventListener("game-time-changed", () => {
    void window
      .loadGameTime()
      .then((records) => {
        allGameTime = records;
        renderGameTime();
      })
      .catch((error: unknown) => {
        gameTimeNotice.textContent = errorMessage(error, "刷新游戏时长失败");
        gameTimeNotice.dataset["kind"] = "error";
      });
  });
  void window
    .loadGameTime()
    .then((records) => {
      allGameTime = records;
      renderGameTime();
    })
    .catch((error: unknown) => {
      gameTimeNotice.textContent = errorMessage(error, "读取游戏时长失败");
      gameTimeNotice.dataset["kind"] = "error";
    });

  gameTimeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const start = new Date(`${gameTimeDate.value}T${gameTimeStart.value}`).getTime();
    const end = new Date(`${gameTimeDate.value}T${gameTimeEnd.value}`).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      gameTimeNotice.textContent = "结束时间必须晚于开始时间。";
      gameTimeNotice.dataset["kind"] = "error";
      return;
    }
    try {
      allGameTime = await window.addGameTime({
        roleId: gameTimeRole.value.trim() || null,
        gameDate: gameTimeDate.value,
        startTime: start,
        endTime: end,
        duration: end - start,
      });
      renderGameTime();
      gameTimeNotice.textContent = "游戏时长已保存。";
      gameTimeNotice.dataset["kind"] = "info";
    } catch (error) {
      gameTimeNotice.textContent = errorMessage(error, "保存游戏时长失败");
      gameTimeNotice.dataset["kind"] = "error";
    }
  });

  scanGameLogsButton.addEventListener("click", async () => {
    scanGameLogsButton.disabled = true;
    gameTimeNotice.textContent = "正在扫描本地游戏日志…";
    gameTimeNotice.dataset["kind"] = "info";
    try {
      const result = await window.importGameTimeLogs(gamePath.value.trim());
      allGameTime = result.records;
      renderGameTime();
      gameTimeNotice.textContent = `扫描 ${result.scannedFiles} 个日志文件，新增 ${result.addedCount} 条，更新 ${result.updatedCount} 条记录。`;
    } catch (error) {
      gameTimeNotice.textContent = errorMessage(error, "扫描游戏日志失败");
      gameTimeNotice.dataset["kind"] = "error";
    } finally {
      scanGameLogsButton.disabled = false;
    }
  });
}
