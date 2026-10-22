import { combineCalculatorResults } from "./calculator-result.ts";
import { buildRoleAim, buildWeaponAim, calculatorSkillNames } from "./calculator-aim.ts";
import type { CalculatorCost, CalculatorResult, CalculatorRole, CalculatorView, CalculatorWeapon, RoleAim, WeaponAim } from "./calculator.ts";
import type { CalculatorTargets } from "./calculator-targets.ts";
import { calculatorRules } from "./calculator-rules.ts";
import { gameIcon, gameImage, itemLabel } from "./game-images.ts";

function find<T extends HTMLElement>(id: string): T {
  return document.querySelector<T>(`#${id}`)!;
}
function errorMessage(error: unknown): string {
  return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : "养成计算失败，请检查目标后重试";
}
function metric(name: string, value: string): HTMLElement {
  const item = document.createElement("article");
  item.className = "metric";
  const title = document.createElement("span");
  title.textContent = name;
  const result = document.createElement("strong");
  result.textContent = value;
  item.append(title, result);
  return item;
}
function renderCosts(container: HTMLTableSectionElement, costs: CalculatorCost[]): void {
  container.replaceChildren(
    ...costs.map((item) => {
      const row = document.createElement("tr");
      const name = document.createElement("td");
      name.append(itemLabel(item.name, item.iconUrl, item.id));
      row.append(name);
      for (const value of [item.count.toLocaleString("zh-CN"), item.quality ? `${item.quality} 星` : "-"]) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    }),
  );
}

export function initializeCalculatorControls(): void {
  const local = find<HTMLButtonElement>("kuro-calculator-local");
  const refresh = find<HTMLButtonElement>("kuro-calculator-refresh");
  const roleSelect = find<HTMLSelectElement>("kuro-calculator-role");
  const weaponSelect = find<HTMLSelectElement>("kuro-calculator-weapon");
  const roleStart = find<HTMLInputElement>("kuro-calculator-role-start");
  const roleEnd = find<HTMLInputElement>("kuro-calculator-role-end");
  const weaponStart = find<HTMLInputElement>("kuro-calculator-weapon-start");
  const weaponEnd = find<HTMLInputElement>("kuro-calculator-weapon-end");
  const calculateRole = find<HTMLButtonElement>("kuro-calculator-role-submit");
  const calculateTogether = find<HTMLButtonElement>("kuro-calculator-combined-submit");
  const calculateWeapon = find<HTMLButtonElement>("kuro-calculator-weapon-submit");
  const notice = find<HTMLElement>("kuro-calculator-notice");
  const metrics = find<HTMLElement>("kuro-calculator-metrics");
  const all = find<HTMLTableSectionElement>("kuro-calculator-all");
  const missing = find<HTMLTableSectionElement>("kuro-calculator-missing");
  const synthetic = find<HTMLTableSectionElement>("kuro-calculator-synthetic");
  let view: CalculatorView | null = null;
  function renderSelection(): void {
    for (const [kind, selected] of [["role", view?.roles.find((item) => item.id === roleSelect.value)], ["weapon", view?.weapons.find((item) => item.id === weaponSelect.value)]] as const) {
      const preview = find<HTMLElement>(`kuro-calculator-${kind}-preview`);
      const image = gameImage(selected?.iconUrl ?? "", "calculator-preview-icon", selected ? gameIcon(selected.name) : "");
      preview.replaceChildren(...(image ? [image] : []));
      preview.hidden = !image;
    }
  }
  let active = false;
  let busy = false;
  let generation = 0;
  const sync = find<HTMLButtonElement>("kuro-calculator-sync");
  const saveRole = find<HTMLButtonElement>("kuro-calculator-role-save");
  const saveWeapon = find<HTMLButtonElement>("kuro-calculator-weapon-save");
  const batchRole = find<HTMLButtonElement>("kuro-calculator-role-batch");
  const batchWeapon = find<HTMLButtonElement>("kuro-calculator-weapon-batch");
  const targetsBody = find<HTMLTableSectionElement>("kuro-calculator-targets");
  let targets: CalculatorTargets = { roles: [], weapons: [] };
  let targetButtons: HTMLButtonElement[] = [];
  let unlocked = new Set<string>();
  const advanceInputs: HTMLInputElement[] = [];
  const skillInputs = calculatorSkillNames.map((name, index) => {
    const row = document.createElement("tr");
    const title = document.createElement("td");
    title.textContent = name;
    row.append(title);
    const levels = ["当前等级", "目标等级"].map((label) => {
      const cell = document.createElement("td");
      const input = document.createElement("input");
      input.type = "number";
      input.min = String(calculatorRules.minimumLevel);
      input.max = String(calculatorRules.maximumSkillLevel);
      input.step = String(calculatorRules.inputStep);
      input.value = String(label === "目标等级" ? calculatorRules.maximumSkillLevel : calculatorRules.defaultLevel);
      input.setAttribute("aria-label", `${name}${label}`);
      cell.append(input);
      row.append(cell);
      return input;
    });
    const nodes = document.createElement("td");
    for (const tier of calculatorRules.skillAscensionTiers) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = true;
      input.value = `${tier}-${index + 1}`;
      input.setAttribute("aria-label", `${name}节点${tier}`);
      advanceInputs.push(input);
      label.append(input, `节点${tier}`);
      nodes.append(label);
    }
    row.append(nodes);
    find<HTMLTableSectionElement>("kuro-calculator-skills").append(row);
    return { start: levels[0]!, end: levels[1]! };
  });
  function clearResult(): void {
    metrics.replaceChildren();
    all.replaceChildren();
    missing.replaceChildren();
    synthetic.replaceChildren();
  }
  function setBusy(value: boolean): void {
    busy = value;
    refresh.disabled = value;
    local.disabled = value;
    roleSelect.disabled = value;
    weaponSelect.disabled = value;
    calculateRole.disabled = value || !roleSelect.value;
    calculateWeapon.disabled = value || !weaponSelect.value;
    calculateTogether.disabled = value || !roleSelect.value || !weaponSelect.value;
    sync.disabled = value || !roleSelect.value;
    saveRole.disabled = value || !roleSelect.value;
    saveWeapon.disabled = value || !weaponSelect.value;
    batchRole.disabled = value || !targets.roles.length;
    batchWeapon.disabled = value || !targets.weapons.length;
    for (const button of targetButtons) button.disabled = value;
    for (const input of [roleStart, roleEnd, weaponStart, weaponEnd, ...skillInputs.flatMap((item) => [item.start, item.end])]) input.disabled = value;
    for (const input of advanceInputs) input.disabled = value || unlocked.has(input.value);
  }
  function resetRole(): void {
    roleStart.value = String(calculatorRules.defaultLevel);
    roleEnd.value = String(calculatorRules.roleMaximumLevel);
    unlocked.clear();
    for (const input of skillInputs) {
      input.start.value = String(calculatorRules.defaultLevel);
      input.end.value = String(calculatorRules.maximumSkillLevel);
    }
    for (const input of advanceInputs) {
      input.checked = true;
      input.disabled = busy;
    }
    clearResult();
  }
  function roleAim(): RoleAim {
    return buildRoleAim(
      roleSelect.value,
      Number(roleStart.value),
      Number(roleEnd.value),
      skillInputs.map((input) => ({
        startLevel: Number(input.start.value),
        endLevel: Number(input.end.value),
      })),
      advanceInputs.filter((input) => input.checked).map((input) => input.value),
    );
  }
  function weaponAim(): WeaponAim {
    return buildWeaponAim(weaponSelect.value, Number(weaponStart.value), Number(weaponEnd.value));
  }
  function renderResult(result: CalculatorResult, label: string): void {
    metrics.replaceChildren(metric("总条目", `${result.roleCount + result.weaponCount}`), metric("总材料", `${result.preview.allCost.length}`), metric("缺少材料", `${result.preview.missingCost.length}`), metric("可合成", `${result.preview.synthetic.length}`));
    renderCosts(all, result.preview.allCost);
    renderCosts(missing, result.preview.missingCost);
    renderCosts(synthetic, result.preview.synthetic);
    notice.textContent = `${label}材料计算完成。`;
  }
  function renderTargets(next: CalculatorTargets): void {
    targets = next;
    targetButtons = [];
    const rows: HTMLTableRowElement[] = [];
    for (const kind of ["role", "weapon"] as const)
      for (const aim of kind === "role" ? next.roles : next.weapons) {
        const id = "roleId" in aim ? aim.roleId : aim.weaponId;
        const entry = (kind === "role" ? view?.roles : view?.weapons)?.find((item) => item.id === id);
        const name = entry?.name ?? id;
        const levels = "roleId" in aim ? `${aim.roleStartLevel} → ${aim.roleEndLevel} 级 · 技能 ${aim.skillLevelUpList.map((skill) => `${skill.startLevel}→${skill.endLevel}`).join(" / ")} · ${aim.advanceSkillList.length} 个节点` : `${aim.weaponStartLevel} → ${aim.weaponEndLevel} 级`;
        const row = document.createElement("tr");
        for (const [index, value] of [kind === "role" ? "角色" : "武器", name, levels].entries()) {
          const cell = document.createElement("td");
          if (index === 1) cell.append(itemLabel(name, entry?.iconUrl ?? "", id));
          else cell.textContent = value;
          row.append(cell);
        }
        const actions = document.createElement("td");
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "secondary-button";
        edit.textContent = "编辑";
        edit.addEventListener("click", () => {
          if (busy) return;
          if (!(kind === "role" ? view?.roles : view?.weapons)?.some((item) => item.id === id)) {
            notice.textContent = "当前目录没有该条目，请刷新目录；保存的目标仍可直接参与批量计算。";
            return;
          }
          if ("roleId" in aim) {
            resetRole();
            roleSelect.value = aim.roleId;
            roleStart.value = String(aim.roleStartLevel);
            roleEnd.value = String(aim.roleEndLevel);
            skillInputs.forEach((input, index) => {
              input.start.value = String(aim.skillLevelUpList[index]!.startLevel);
              input.end.value = String(aim.skillLevelUpList[index]!.endLevel);
            });
            for (const input of advanceInputs) input.checked = aim.advanceSkillList.includes(input.value);
          } else {
            weaponSelect.value = aim.weaponId;
            weaponStart.value = String(aim.weaponStartLevel);
            weaponEnd.value = String(aim.weaponEndLevel);
          }
          clearResult();
          renderSelection();
          setBusy(false);
          notice.textContent = `已载入 ${name} 的目标，修改后点击保存。`;
        });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "secondary-button";
        remove.textContent = "移除";
        remove.addEventListener("click", () => {
          void mutateTarget(() => window.removeKuroCalculatorTarget(kind, id), "目标已移除。");
        });
        targetButtons.push(edit, remove);
        actions.append(edit, remove);
        row.append(actions);
        rows.push(row);
      }
    targetsBody.replaceChildren(...rows);
  }
  async function mutateTarget(operation: () => Promise<CalculatorTargets>, message: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    const current = ++generation;
    try {
      const next = await operation();
      if (current === generation) {
        renderTargets(next);
        clearResult();
        notice.dataset["kind"] = "info";
        notice.textContent = message;
      }
    } catch (error) {
      if (current === generation) {
        notice.dataset["kind"] = "error";
        notice.textContent = errorMessage(error);
      }
    } finally {
      if (current === generation) setBusy(false);
    }
  }
  function render(next: CalculatorView): void {
    view = next;
    const selectedRole = roleSelect.value;
    const selectedWeapon = weaponSelect.value;
    roleSelect.replaceChildren(...next.roles.map((item: CalculatorRole) => new Option(`${item.name} · ${item.starLevel} 星`, item.id)));
    weaponSelect.replaceChildren(...next.weapons.map((item: CalculatorWeapon) => new Option(`${item.name} · ${item.starLevel} 星`, item.id)));
    if (next.roles.some((item) => item.id === selectedRole)) roleSelect.value = selectedRole;
    else resetRole();
    if (next.weapons.some((item) => item.id === selectedWeapon)) weaponSelect.value = selectedWeapon;
    renderSelection();
    notice.textContent = `${next.cached ? "本地缓存 · " : ""}${next.roleName} · ${next.roles.length} 个角色、${next.weapons.length} 把武器，更新于 ${new Date(next.updatedAt).toLocaleString("zh-CN")}`;
  }
  async function load(force: boolean, localOnly = false): Promise<void> {
    if (busy) return;
    setBusy(true);
    const current = ++generation;
    notice.dataset["kind"] = "info";
    notice.textContent = "正在读取养成目录…";
    try {
      const [next, saved] = await Promise.allSettled([window.loadKuroCalculator(force, localOnly), window.loadKuroCalculatorTargets()]);
      if (current !== generation) return;
      if (next.status === "fulfilled") render(next.value);
      if (saved.status === "fulfilled") renderTargets(saved.value);
      if (next.status === "rejected") throw next.reason;
      if (saved.status === "rejected") throw saved.reason;
    } catch (error) {
      if (current === generation) {
        notice.dataset["kind"] = "error";
        notice.textContent = errorMessage(error);
      }
    } finally {
      if (current === generation) setBusy(false);
    }
  }
  async function calculate(kind: "role" | "weapon" | "combined", batch = false): Promise<void> {
    if (busy || (!batch && !view)) return;
    setBusy(true);
    const current = ++generation;
    notice.dataset["kind"] = "info";
    notice.textContent = "正在计算材料…";
    try {
      const combinedRole = kind === "combined" ? roleAim() : null;
      const combinedWeapon = kind === "combined" ? weaponAim() : null;
      const result = combinedRole && combinedWeapon
        ? combineCalculatorResults(await Promise.all([window.calculateKuroRole(combinedRole), window.calculateKuroWeapon(combinedWeapon)]))
        : batch ? (kind === "role" ? await window.calculateKuroRoleBatch(targets.roles) : await window.calculateKuroWeaponBatch(targets.weapons)) : kind === "role" ? await window.calculateKuroRole(roleAim()) : await window.calculateKuroWeapon(weaponAim());
      if (current === generation) renderResult(result, batch ? (kind === "role" ? "全部角色" : "全部武器") : kind === "combined" ? "角色与武器合计" : "");
    } catch (error) {
      if (current === generation) {
        notice.dataset["kind"] = "error";
        notice.textContent = errorMessage(error);
      }
    } finally {
      if (current === generation) setBusy(false);
    }
  }
  sync.addEventListener("click", async () => {
    if (busy || !view || !roleSelect.value) return;
    setBusy(true);
    const current = ++generation;
    notice.dataset["kind"] = "info";
    notice.textContent = "正在同步角色练度…";
    try {
      const cultivation = await window.loadKuroCultivation(roleSelect.value);
      if (current !== generation) return;
      roleStart.value = String(cultivation.roleLevel);
      roleEnd.value = String(Math.max(cultivation.roleLevel, Number(roleEnd.value) || cultivation.roleLevel));
      skillInputs.forEach((input, index) => {
        const level = cultivation.skillLevels[index]!;
        input.start.value = String(level);
        input.end.value = String(Math.max(level, Number(input.end.value) || level));
      });
      unlocked = new Set(cultivation.unlockedNodes);
      for (const input of advanceInputs) input.checked = !unlocked.has(input.value);
      clearResult();
      notice.textContent = "当前练度已同步，可调整目标等级和待解锁节点后计算。";
    } catch (error) {
      if (current === generation) {
        notice.dataset["kind"] = "error";
        notice.textContent = errorMessage(error);
      }
    } finally {
      if (current === generation) setBusy(false);
    }
  });
  roleSelect.addEventListener("change", () => {
    resetRole();
    renderSelection();
    setBusy(false);
  });
  weaponSelect.addEventListener("change", () => {
    clearResult();
    renderSelection();
  });
  for (const input of [roleStart, roleEnd, weaponStart, weaponEnd, ...skillInputs.flatMap((item) => [item.start, item.end]), ...advanceInputs]) input.addEventListener("input", clearResult);
  refresh.addEventListener("click", () => {
    void load(true);
  });
  calculateTogether.addEventListener("click", async () => {
    await calculate("combined");
  });
  calculateRole.addEventListener("click", () => {
    void calculate("role");
  });
  calculateWeapon.addEventListener("click", () => {
    void calculate("weapon");
  });
  local.addEventListener("click", () => {
    void load(false, true);
  });
  saveRole.addEventListener("click", () => {
    void mutateTarget(() => window.saveKuroCalculatorTarget({ kind: "role", aim: roleAim() }), "角色目标已保存。");
  });
  saveWeapon.addEventListener("click", () => {
    void mutateTarget(() => window.saveKuroCalculatorTarget({ kind: "weapon", aim: weaponAim() }), "武器目标已保存。");
  });
  batchRole.addEventListener("click", () => {
    void calculate("role", true);
  });
  batchWeapon.addEventListener("click", () => {
    void calculate("weapon", true);
  });
  window.addEventListener("page-changed", (event) => {
    active = (event as CustomEvent<string>).detail === "calculator";
    if (active) void load(false);
  });
  window.addEventListener("kuro-account-changed", () => {
    generation++;
    view = null;
    renderTargets({ roles: [], weapons: [] });
    roleSelect.replaceChildren();
    weaponSelect.replaceChildren();
    renderSelection();
    resetRole();
    weaponStart.value = String(calculatorRules.defaultLevel);
    weaponEnd.value = String(calculatorRules.weaponMaximumLevel);
    setBusy(false);
    notice.textContent = "角色已切换，进入本页后自动查询。";
    if (active) void load(false);
  });
  setBusy(false);
}
