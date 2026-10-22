import { battleFields, summarizeBattles, type LocalArchive } from "./model.ts";
import { itemLabel } from "../kujiequ/game-images.ts";

export function initializeLocalDataControls(): void {
  const find = <T extends HTMLElement>(id: string): T => document.querySelector<T>(`#${id}`)!;
  const player = find<HTMLSelectElement>("local-data-player"),
    start = find<HTMLInputElement>("local-data-start"),
    end = find<HTMLInputElement>("local-data-end"),
    search = find<HTMLInputElement>("local-data-search");
  const refresh = find<HTMLButtonElement>("local-data-refresh"),
    notice = find<HTMLElement>("local-data-notice");
  const importLogs = find<HTMLButtonElement>("local-data-import-logs");
  let scanning = false;
  let archive: LocalArchive = { battles: [], players: [], roles: [] },
    generation = 0,
    active = false;
  function table(id: string, rows: (string | HTMLElement)[][]): void {
    find<HTMLElement>(id).replaceChildren(
      ...rows.map((values) => {
        const row = document.createElement("tr");
        for (const value of values) {
          const cell = document.createElement("td");
          if (typeof value === "string") cell.textContent = value;
          else cell.append(value);
          row.append(cell);
        }
        return row;
      }),
    );
  }
  function render(): void {
    const battles = archive.battles.filter((row) => (!player.value || row.roleId === player.value || (player.value === "unassigned" && row.roleId === null)) && (!start.value || row.date >= start.value) && (!end.value || row.date <= end.value));
    const totals = summarizeBattles(battles);
    find<HTMLElement>("local-data-metrics").replaceChildren(
      ...(battles.length ? Object.entries(battleFields) : []).map(([key, name]) => {
        const item = document.createElement("article");
        item.className = "metric";
        const label = document.createElement("span");
        label.textContent = name;
        const count = document.createElement("strong");
        count.textContent = String(totals[key as keyof typeof battleFields]);
        item.append(label, count);
        return item;
      }),
    );
    table(
      "local-data-battles",
      battles.map((row) => [row.date, row.roleId ?? "未识别玩家", ...Object.keys(battleFields).map((key) => String(row[key as keyof typeof battleFields])), row.monthCard ? `剩余 ${row.monthCardRemainDays} 天` : "无"]),
    );
    table(
      "local-data-players",
      archive.players.filter((row) => !player.value || row.roleId === player.value).map((row) => [row.roleId, itemLabel(row.name, row.headPhoto), String(row.level), row.region, String(row.sex), new Date(row.updatedAt).toLocaleString("zh-CN")]),
    );
    const query = search.value.trim().toLocaleLowerCase();
    const roles = archive.roles.filter((row) => !query || [row.roleId, row.name, row.acronym, row.attributeName, row.weaponTypeName].some((value) => value.toLocaleLowerCase().includes(query)));
    table(
      "local-data-roles",
      roles.map((row) => [row.roleId, itemLabel(row.name, row.iconUrl || row.pictureUrl, row.roleId), `${row.starLevel} 星`, row.attributeName, row.weaponTypeName, String(row.breach), row.acronym]),
    );
    notice.textContent = `当前范围 ${battles.length} 条战斗日报，闪避合计 ${totals.parryFront + totals.parryBack} 次；本地玩家 ${archive.players.length} 个，图鉴 ${roles.length} 个角色。`;
    if (!archive.battles.length && !archive.players.length && !archive.roles.length) notice.textContent = "还没有本地档案。可扫描当前游戏战斗日志，或在「数据迁移」中导入已有档案。";
    notice.dataset["kind"] = "info";
    if (start.value && end.value && start.value > end.value) {
      notice.textContent = "开始日期应早于或等于结束日期。";
      notice.dataset["kind"] = "error";
    }
  }
  async function load(): Promise<void> {
    const current = ++generation;
    refresh.disabled = true;
    try {
      const next = await window.loadLocalArchive();
      if (current !== generation) return;
      archive = next;
      const selected = player.value;
      const ids = [...new Set([...archive.players.map((row) => row.roleId), ...archive.battles.flatMap((row) => (row.roleId ? [row.roleId] : []))])].sort();
      player.replaceChildren(new Option("全部玩家", ""), ...ids.map((id) => new Option(`${archive.players.find((row) => row.roleId === id)?.name || id} · ${id}`, id)));
      if (archive.battles.some((row) => row.roleId === null)) player.add(new Option("未识别玩家", "unassigned"));
      player.value = [...player.options].some((option) => option.value === selected) ? selected : "";
      render();
    } catch (error) {
      if (current === generation) {
        notice.dataset["kind"] = "error";
        notice.textContent = error instanceof Error ? error.message : "读取本地档案失败";
      }
    } finally {
      if (current === generation) refresh.disabled = false;
    }
  }
  for (const control of [player, start, end]) control.addEventListener("change", render);
  search.addEventListener("input", render);
  refresh.addEventListener("click", () => {
    void load();
  });
  importLogs.addEventListener("click", async () => {
    if (scanning) return;
    scanning = true;
    importLogs.disabled = true;
    refresh.disabled = true;
    notice.textContent = "正在读取并分析当前游戏日志…";
    notice.dataset["kind"] = "info";
    try {
      const settings = await window.loadGameSettings();
      if (!settings.executablePath) throw new Error("请先在游戏页面选择游戏主程序");
      const result = await window.importBattleLogs(settings.executablePath);
      await load();
      notice.textContent = `扫描 ${result.scannedFiles} 个日志，新增 ${result.addedCount} 个事件，跳过 ${result.duplicateCount} 个重复事件。`;
    } catch (error) {
      notice.dataset["kind"] = "error";
      notice.textContent = error instanceof Error ? error.message : "扫描战斗日志失败";
    } finally {
      scanning = false;
      importLogs.disabled = false;
      refresh.disabled = false;
    }
  });
  window.addEventListener("page-changed", (event) => {
    active = (event as CustomEvent<string>).detail === "local-data";
    if (active) void load();
  });
  window.addEventListener("local-archive-changed", () => {
    if (active) void load();
  });
}
