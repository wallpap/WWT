import type { KuroRoleDetail, KuroRoleProp, KuroRoleView } from "./role.ts";
import { gameIcon, gameImage, remoteImage } from "./game-images.ts";

const roleDescriptionLimit = { long: 180, skill: 120 } as const;

function find<T extends HTMLElement>(id: string): T {
  const element = document.querySelector<T>(`#${id}`);
  if (!element) throw new Error(`界面缺少元素：#${id}`);
  return element;
}

function message(error: unknown): string {
  return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : "角色数据查询失败，请刷新后重试";
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

function iconBox(className: string, url: string, name: string, fallbackUrl = ""): HTMLElement {
  const box = node("div", className);
  const fallback = node("span", "role-icon-fallback", name.slice(0, 1) || "?");
  const catalogIcon = gameIcon(name);
  const image = remoteImage(url || catalogIcon, `${className}-image`, name, fallbackUrl || catalogIcon, (failed) => failed.replaceWith(fallback));
  box.append(image ?? fallback);
  return box;
}

function tag(label: string, accent = false): HTMLElement {
  return node("span", accent ? "role-tag role-tag-accent" : "role-tag", label);
}

function stat(name: string, value: string): HTMLElement {
  const item = node("div", "role-stat");
  item.append(node("span", "role-stat-label", name), node("strong", "role-stat-value", value));
  return item;
}

function empty(message: string): HTMLElement {
  return node("p", "role-empty", message);
}

function description(text: string, className: string, limit: number): HTMLElement[] {
  const paragraph = node("p", text.length > limit ? `${className} is-clamped` : className, text);
  if (text.length <= limit) return [paragraph];
  const toggle = node("button", "role-desc-toggle", "展开全文");
  toggle.type = "button";
  toggle.ariaExpanded = "false";
  let expanded = false;
  toggle.addEventListener("click", () => {
    expanded = !expanded;
    paragraph.className = expanded ? className : `${className} is-clamped`;
    toggle.textContent = expanded ? "收起" : "展开全文";
    toggle.ariaExpanded = String(expanded);
  });
  return [paragraph, toggle];
}

function skillTone(type: string): string {
  if (type === "共鸣技能") return "skill";
  if (type === "共鸣解放") return "burst";
  if (type === "变奏技能") return "variation";
  if (type === "共鸣回路") return "circuit";
  if (type === "延奏技能") return "outro";
  return "normal";
}

function property(prop: KuroRoleProp, main: boolean): HTMLElement {
  const item = node("span", main ? "role-prop is-main" : "role-prop");
  item.append(node("span", "role-prop-name", prop.name || "词条"), node("strong", "role-prop-value", prop.value || "-"));
  return item;
}

function renderDetail(detail: KuroRoleDetail | null): void {
  const notice = find<HTMLElement>("kuro-role-detail-notice");
  const profile = find<HTMLElement>("kuro-role-profile");
  const metrics = find<HTMLElement>("kuro-role-metrics");
  const attributes = find<HTMLElement>("kuro-role-attributes");
  const chains = find<HTMLOListElement>("kuro-role-chains");
  const weapon = find<HTMLElement>("kuro-role-weapon");
  const phantoms = find<HTMLElement>("kuro-role-phantoms");
  const skills = find<HTMLElement>("kuro-role-skills");
  const attributeCount = find<HTMLElement>("kuro-role-attribute-count");
  const weaponCount = find<HTMLElement>("kuro-role-weapon-count");
  const chainCount = find<HTMLElement>("kuro-role-chain-count");
  const phantomCount = find<HTMLElement>("kuro-role-phantom-count");
  const skillCount = find<HTMLElement>("kuro-role-skill-count");
  notice.textContent = "";
  attributeCount.textContent = "";
  weaponCount.textContent = "";
  chainCount.textContent = "";
  phantomCount.textContent = "";
  skillCount.textContent = "";
  if (!detail) {
    profile.replaceChildren();
    metrics.replaceChildren();
    attributes.replaceChildren();
    chains.replaceChildren();
    weapon.replaceChildren();
    phantoms.replaceChildren();
    skills.replaceChildren();
    return;
  }
  const portrait = iconBox("role-portrait", detail.iconUrl || detail.pictureUrl, detail.name, detail.iconUrl ? detail.pictureUrl : "");
  const copy = node("div", "role-profile-copy");
  copy.append(node("span", "role-eyebrow", "角色档案"), node("strong", "role-profile-name", detail.name));
  const tags = node("div", "role-tags");
  if (detail.attributeName) tags.append(tag(detail.attributeName, true));
  if (detail.weaponTypeName) tags.append(tag(detail.weaponTypeName));
  copy.append(tags);
  profile.replaceChildren(portrait, copy);
  metrics.replaceChildren(stat("等级", `Lv.${detail.level}`), stat("突破", `${detail.breach}`), stat("星级", `${detail.starLevel}`), stat("声骸", `${detail.phantoms.length} 个`), stat("共鸣链", `${detail.chains.filter((item) => item.unlocked).length} / ${detail.chains.length}`));
  attributeCount.textContent = `${detail.attributes.length} 项`;
  weaponCount.textContent = detail.weapon ? (detail.weapon.starLevel ? `${detail.weapon.starLevel} 星` : "已装备") : "未装备";
  chainCount.textContent = `${detail.chains.filter((item) => item.unlocked).length} / ${detail.chains.length} 已解锁`;
  phantomCount.textContent = `${detail.phantoms.length} 件`;
  skillCount.textContent = `${detail.skills.length} 项`;
  attributes.replaceChildren(
    ...detail.attributes.map((item) => {
      const fact = node("div", "role-fact");
      const name = node("span", "role-fact-name");
      const image = gameImage(item.iconUrl, "role-attribute-icon");
      if (image) name.append(image);
      name.append(node("span", "", item.name || "属性"));
      fact.append(name, node("strong", "role-fact-value", item.value || "-"));
      return fact;
    }),
  );
  if (!detail.attributes.length) attributes.append(empty("暂无属性数据"));
  weapon.replaceChildren();
  if (!detail.weapon) weapon.append(empty("未装备武器"));
  else {
    const card = node("div", "role-weapon-card");
    const info = node("div", "role-weapon-copy");
    info.append(node("span", "role-eyebrow", "装备武器"), node("strong", "role-weapon-name", detail.weapon.name || "未命名武器"));
    const weaponTags = node("div", "role-tags");
    if (detail.weapon.starLevel) weaponTags.append(tag(`${detail.weapon.starLevel} 星`));
    weaponTags.append(tag(`Lv.${detail.weapon.level}`), tag(`突破 ${detail.weapon.breach}`), tag(`共鸣 ${detail.weapon.resonLevel}`));
    info.append(weaponTags);
    if (detail.weapon.effectName) info.append(node("strong", "role-weapon-effect-name", detail.weapon.effectName));
    if (detail.weapon.effectDescription) info.append(node("p", "role-weapon-effect", detail.weapon.effectDescription));
    card.append(iconBox("role-weapon-icon", detail.weapon.iconUrl, detail.weapon.name), info);
    weapon.append(card);
  }
  chains.replaceChildren(
    ...detail.chains.map((item) => {
      const row = node("li", item.unlocked ? "role-chain is-unlocked" : "role-chain");
      const body = node("div", "role-chain-body");
      const head = node("div", "role-chain-head");
      head.append(node("strong", "role-chain-name", item.name || "未命名共鸣链"), node("span", item.unlocked ? "role-status is-on" : "role-status", item.unlocked ? "已解锁" : "未解锁"));
      body.append(head);
      if (item.description) body.append(...description(item.description, "role-chain-desc", roleDescriptionLimit.long));
      row.append(node("span", "role-chain-order", String(item.order).padStart(2, "0")), body);
      return row;
    }),
  );
  if (!detail.chains.length) chains.append(empty("暂无共鸣链数据"));
  phantoms.replaceChildren(
    ...detail.phantoms.map((item) => {
      const card = node("article", "role-phantom");
      const head = node("div", "role-phantom-head");
      const info = node("div", "role-phantom-copy");
      info.append(node("strong", "role-phantom-name", item.name || "未命名声骸"), node("span", "role-phantom-meta", `Lv.${item.level} · ${item.quality} 星 · COST ${item.cost}`));
      head.append(iconBox("role-phantom-icon", item.iconUrl, item.name), info);
      card.append(head);
      const props = node("div", "role-props");
      for (const prop of item.mainProps) props.append(property(prop, true));
      for (const prop of item.subProps) props.append(property(prop, false));
      if (props.children.length) card.append(props);
      if (item.skillDescription) card.append(...description(item.skillDescription, "role-phantom-skill", roleDescriptionLimit.long));
      return card;
    }),
  );
  if (!detail.phantoms.length) phantoms.append(empty("暂无声骸数据"));
  skills.replaceChildren(
    ...detail.skills.map((item) => {
      const card = node("article", "role-skill");
      const head = node("div", "role-skill-head");
      const image = gameImage(item.iconUrl, "role-skill-icon");
      if (image) head.append(image);
      head.append(node("span", `role-skill-type role-skill-type-${skillTone(item.type)}`, item.type || "技能"), node("strong", "role-skill-name", item.name));
      if (item.level) head.append(node("span", "role-skill-level", `Lv.${item.level}`));
      card.append(head);
      if (item.description) card.append(...description(item.description, "role-skill-desc", roleDescriptionLimit.skill));
      return card;
    }),
  );
  if (!detail.skills.length) skills.append(empty("暂无技能数据"));
}

export function initializeRoleControls(): void {
  const page = document.querySelector<HTMLElement>("[data-page='role']");
  if (!page) return;
  const refresh = find<HTMLButtonElement>("kuro-role-refresh");
  const local = find<HTMLButtonElement>("kuro-role-local");
  const roleSelect = find<HTMLSelectElement>("kuro-role-select");
  const notice = find<HTMLElement>("kuro-role-notice");
  let view: KuroRoleView | null = null;
  let generation = 0;
  let active = false;
  let busy = false;
  let localView = false;
  function render(next: KuroRoleView): void {
    view = next;
    roleSelect.replaceChildren(...next.roles.map((item) => new Option(`${item.name} · Lv.${item.level}`, item.roleId)));
    roleSelect.value = next.detail?.roleId ?? next.roles[0]?.roleId ?? "";
    renderDetail(next.detail);
    notice.textContent = next.roles.length ? `${localView ? "本地缓存 · " : ""}${next.roleName} · ${next.roles.length} 个已拥有角色，更新于 ${new Date(next.updatedAt).toLocaleString("zh-CN")}` : "当前账号暂无角色数据";
    if (localView && next.roles.length && !next.detail) notice.textContent += "。所选角色尚无本地详情。";
  }
  async function load(force: boolean, localOnly = false): Promise<void> {
    if (busy) return;
    busy = true;
    refresh.disabled = true;
    local.disabled = true;
    roleSelect.disabled = true;
    const current = ++generation;
    notice.dataset["kind"] = "info";
    notice.textContent = "正在查询角色数据…";
    try {
      const next = localOnly ? await window.loadLocalKuroRoleData() : await window.loadKuroRoleData(force);
      if (current === generation) {
        localView = localOnly;
        render(next);
      }
    } catch (error) {
      if (current === generation) {
        notice.dataset["kind"] = "error";
        notice.textContent = message(error);
        if (!localOnly) {
          try {
            const saved = await window.loadLocalKuroRoleData();
            if (current === generation) {
              localView = true;
              render(saved);
              notice.textContent = `${message(error)}。${notice.textContent}`;
            }
          } catch {
            /* 保留联网查询失败的原因。 */
          }
        }
      }
    } finally {
      if (current === generation) {
        busy = false;
        refresh.disabled = false;
        local.disabled = false;
        roleSelect.disabled = false;
      }
    }
  }
  refresh.addEventListener("click", () => {
    void load(true);
  });
  local.addEventListener("click", () => load(false, true));
  roleSelect.addEventListener("change", async () => {
    if (!roleSelect.value || busy || !view) return;
    busy = true;
    refresh.disabled = true;
    local.disabled = true;
    roleSelect.disabled = true;
    renderDetail(null);
    const current = ++generation;
    notice.dataset["kind"] = "info";
    notice.textContent = "正在查询角色详情…";
    try {
      const detail = await window.loadKuroRoleDetail(roleSelect.value, localView);
      if (current === generation) {
        view = { ...view, detail };
        renderDetail(detail);
        notice.textContent = `${localView ? "本地缓存 · " : ""}${detail.name} · ${detail.attributeName || "未知属性"} · ${detail.weaponTypeName || "未知武器"}`;
      }
    } catch (error) {
      if (current === generation) {
        notice.dataset["kind"] = "error";
        notice.textContent = message(error);
      }
    } finally {
      if (current === generation) {
        busy = false;
        refresh.disabled = false;
        local.disabled = false;
        roleSelect.disabled = false;
      }
    }
  });
  window.addEventListener("page-changed", (event) => {
    active = (event as CustomEvent<string>).detail === "role";
    if (active) void load(false);
  });
  window.addEventListener("kuro-account-changed", () => {
    generation++;
    view = null;
    localView = false;
    busy = false;
    refresh.disabled = false;
    local.disabled = false;
    roleSelect.disabled = false;
    roleSelect.replaceChildren();
    renderDetail(null);
    notice.textContent = "角色已切换，进入本页后自动查询。";
    if (active) void load(false);
  });
}
