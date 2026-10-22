import type { GachaRecord } from "./model.ts";
import { summarizeGacha } from "./stats.ts";
import { itemLabel } from "../kujiequ/game-images.ts";
import { initializeOnlineGacha } from "./controls.ts";
import { initializeGachaHistory } from "./history-controls.ts";
import { defaultGachaPageSize } from "./constants.ts";
import { appErrorMessage as errorMessage } from "../app/error-message.ts";

const gachaRecordColumnCount = 6;
const gachaQualityColumnIndex = 4;
const binaryStringChunkSize = 0x8000;
const recordDateFormatter = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });

export function initializeGachaRecordControls(): void {
  const renderGachaHistory = initializeGachaHistory();
  const query = <ElementType extends Element>(selector: string): ElementType => {
    const element = document.querySelector<ElementType>(selector);
    if (!element) throw new Error(`界面缺少元素：${selector}`);
    return element;
  };

  const form = query<HTMLFormElement>("#import-form");
  const fileInput = query<HTMLInputElement>("#import-file");
  const playerInput = query<HTMLInputElement>("#player-id");
  const playerFilter = query<HTMLSelectElement>("#player-filter");
  const poolFilter = query<HTMLSelectElement>("#pool-filter");
  const exportJsonButton = query<HTMLButtonElement>("#export-json-button");
  const exportXlsxButton = query<HTMLButtonElement>("#export-xlsx-button");
  const notice = query<HTMLElement>("#notice");
  const recordsBody = query<HTMLTableSectionElement>("#records-body");
  const recordsCount = query<HTMLElement>("#records-count");
  let allRecords: GachaRecord[] = [];

  initializeOnlineGacha(async (records) => {
    allRecords = records;
    await render();
  });

  function formatDate(value: string | null): string {
    if (!value) return "暂无";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : recordDateFormatter.format(date);
  }

  function setNotice(message: string, kind: "info" | "error" = "info"): void {
    notice.textContent = message;
    notice.dataset["kind"] = kind;
  }

  let visibleGachaCount = defaultGachaPageSize;
  const moreGacha = query<HTMLButtonElement>("#gacha-load-more");
  moreGacha.type = "button";
  moreGacha.textContent = "加载更多记录";

  moreGacha.addEventListener("click", () => {
    visibleGachaCount += defaultGachaPageSize;
    void render();
  });

  function selectedRecords(): GachaRecord[] {
    return allRecords
      .filter((record) => !playerFilter.value || record.playerId === playerFilter.value)
      .filter((record) => !poolFilter.value || record.gachaName === poolFilter.value)
      .map((record) => ({ record, timestamp: Date.parse(record.time) }))
      .sort((left, right) => right.timestamp - left.timestamp)
      .map(({ record }) => record);
  }

  function fillSelect(select: HTMLSelectElement, values: string[], selected: string, allLabel = "全部"): void {
    select.replaceChildren(new Option(allLabel, ""));
    for (const value of values) select.add(new Option(value, value));
    select.value = values.includes(selected) ? selected : "";
  }

  async function render(): Promise<void> {
    const players = [...new Set(allRecords.map((record) => record.playerId))].sort();
    const pools = [...new Set(allRecords.filter((record) => !playerFilter.value || record.playerId === playerFilter.value).map((record) => record.gachaName))].sort();
    fillSelect(playerFilter, players, playerFilter.value, "全部玩家");
    fillSelect(poolFilter, pools, poolFilter.value);

    const records = selectedRecords();
    const playerRecords = allRecords.filter((record) => !playerFilter.value || record.playerId === playerFilter.value);
    renderGachaHistory(playerRecords);
    const summary = summarizeGacha(playerRecords);
    exportJsonButton.disabled = playerRecords.length === 0;
    exportXlsxButton.disabled = playerRecords.length === 0;
    query<HTMLElement>("#metric-pulls").textContent = summary.totalPulls.toLocaleString();
    query<HTMLElement>("#metric-stones").textContent = summary.totalStones.toLocaleString();
    query<HTMLElement>("#metric-ssr").textContent = summary.ssrCount.toLocaleString();
    query<HTMLElement>("#metric-up-ssr").textContent = summary.upSsrCount.toLocaleString();
    query<HTMLElement>("#metric-non-banner").textContent = `${summary.nonBannerRate.toFixed(1)}%`;
    query<HTMLElement>("#metric-role-weapon").textContent = `${summary.rolePulls.toLocaleString()} / ${summary.weaponPulls.toLocaleString()}`;
    query<HTMLElement>("#top-up-ssr").textContent = summary.topUpSsr ?? "暂无";
    query<HTMLElement>("#metric-average").textContent = summary.averagePullsPerSsr.toFixed(1);
    query<HTMLElement>("#metric-range").textContent = summary.startTime ? `${formatDate(summary.startTime)} 至 ${formatDate(summary.endTime)}` : "暂无记录";
    query<HTMLElement>("#top-ssr").textContent = summary.topSsr ?? "暂无";
    recordsCount.textContent = `${records.length.toLocaleString()} 条记录，已显示 ${Math.min(visibleGachaCount, records.length).toLocaleString()} 条`;
    moreGacha.hidden = visibleGachaCount >= records.length;

    const rows = records.slice(0, visibleGachaCount).map((record) => {
      const row = document.createElement("tr");
      const values = [formatDate(record.time), record.playerId, record.gachaName, record.name, `${record.qualityLevel} 星`, record.resourceType];
      for (const [index, value] of values.entries()) {
        const cell = document.createElement("td");
        if (index === gachaQualityColumnIndex) {
          const badge = document.createElement("span");
          badge.className = `quality-badge quality-${record.qualityLevel}`;
          badge.textContent = value!;
          cell.append(badge);
        } else if (index === 3) cell.append(itemLabel(record.name, "", record.resourceId));
        else cell.textContent = value!;
        row.append(cell);
      }
      return row;
    });
    if (rows.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.className = "empty-state";
      cell.colSpan = gachaRecordColumnCount;
      cell.textContent = "尚无记录";
      row.append(cell);
      rows.push(row);
    }
    recordsBody.replaceChildren(...rows);
  }

  playerFilter.addEventListener("change", () => {
    poolFilter.value = "";
    void render();
  });
  poolFilter.addEventListener("change", () => void render());
  async function exportRecords(format: "json" | "xlsx"): Promise<void> {
    const records = allRecords.filter((record) => !playerFilter.value || record.playerId === playerFilter.value);
    if (records.length === 0) return;
    try {
      const result = await window.exportRecords(records, format);
      const notice = query<HTMLElement>("#gacha-action-notice");
      notice.dataset["kind"] = "info";
      notice.textContent = `已导出 ${records.length.toLocaleString()} 条记录：${result.path}`;
    } catch (error) {
      const notice = query<HTMLElement>("#gacha-action-notice");
      notice.dataset["kind"] = "error";
      notice.textContent = errorMessage(error, "导出失败");
    }
  }

  function encodeBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += binaryStringChunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + binaryStringChunkSize));
    }
    return btoa(binary);
  }

  exportJsonButton.addEventListener("click", () => void exportRecords("json"));
  exportXlsxButton.addEventListener("click", () => void exportRecords("xlsx"));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = fileInput.files?.[0];
    if (!file) return;

    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!button) return;
    button.disabled = true;
    setNotice("正在导入并合并记录…");
    try {
      const isXlsx = file.name.toLowerCase().endsWith(".xlsx");
      const payload = isXlsx
        ? {
            format: "xlsx" as const,
            data: encodeBase64(new Uint8Array(await file.arrayBuffer())),
          }
        : { format: "json" as const, data: await file.text() };
      const result = await window.importRecords(payload, playerInput.value.trim());
      allRecords = result.records;
      await render();
      setNotice(`导入完成：新增 ${result.addedCount} 条，跳过重复 ${result.duplicateCount} 条`);
      fileInput.value = "";
    } catch (error) {
      setNotice(errorMessage(error, "导入失败"), "error");
    } finally {
      button.disabled = false;
    }
  });

  window.addEventListener("gacha-records-changed", () => {
    void window
      .loadRecords()
      .then(async ({ records }) => {
        allRecords = records;
        await render();
      })
      .catch((error: unknown) => setNotice(errorMessage(error, "读取本地抽卡数据失败"), "error"));
  });

  void window
    .loadRecords()
    .then(({ records }) => {
      allRecords = records;
      query<HTMLDetailsElement>("#gacha-import").open = records.length === 0;
      return render();
    })
    .catch((error: unknown) => {
      setNotice(errorMessage(error, "读取本地抽卡数据失败"), "error");
    });
}
