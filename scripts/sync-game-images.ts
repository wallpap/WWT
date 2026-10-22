import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export type GameResourceKind = "character" | "weapon" | "echo" | "item";

export interface GameResource {
  kind: GameResourceKind;
  resourceId: string;
  name: string;
  imageUrl: string;
}

export interface GameResourceCatalogMetadata {
  sourceName: string;
  sourceUrl: string;
  syncedAt: string;
  endpoints: Record<GameResourceKind, string>;
  counts: Record<GameResourceKind, number>;
  total: number;
  skippedWithoutImage: number;
}

export interface BuiltGameResourceCatalog {
  metadata: GameResourceCatalogMetadata;
  catalog: GameResource[];
}

const sourceUrl = "https://api.encore.moe";
const endpoints: Record<GameResourceKind, string> = {
  character: `${sourceUrl}/zh-Hans/character`,
  weapon: `${sourceUrl}/zh-Hans/weapon`,
  echo: `${sourceUrl}/zh-Hans/echo`,
  item: `${sourceUrl}/zh-Hans/item`,
};

const endpointFields: Record<GameResourceKind, { rows: string; image: string }> = {
  character: { rows: "roleList", image: "RoleHeadIcon" },
  weapon: { rows: "weapons", image: "Icon" },
  echo: { rows: "Echo", image: "Icon" },
  item: { rows: "itemList", image: "Icon" },
};

const minimumRecordCounts: Record<GameResourceKind, number> = {
  character: 50,
  weapon: 100,
  echo: 250,
  item: 1_800,
};

const kindOrder: GameResourceKind[] = ["character", "weapon", "echo", "item"];

function record(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function recordsAt(payload: unknown, path: string): unknown[] {
  const root = record(payload, `${path} 返回格式无效`);
  const rows = root[path];
  if (!Array.isArray(rows)) throw new Error(`接口缺少列表字段 ${path}`);
  return rows;
}

function resourceId(value: unknown, kind: GameResourceKind): string {
  const id = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!/^\d+$/.test(id)) throw new Error(`${kind} 资源缺少有效 ID`);
  return id;
}

function imageUrl(value: unknown, kind: GameResourceKind): string {
  if (typeof value !== "string" || !value.trim()) {
    if (kind === "item") return "";
    throw new Error(`${kind} 资源缺少图片地址`);
  }
  const url = new URL(value.trim());
  if (url.protocol !== "https:") throw new Error(`${kind} 图片地址必须使用 HTTPS`);
  return url.toString();
}

function makeResources(kind: GameResourceKind, payload: unknown): { resources: GameResource[]; skipped: number } {
  const fields = endpointFields[kind];
  const rows = recordsAt(payload, fields.rows);
  if (rows.length < minimumRecordCounts[kind]) throw new Error(`${kind} 目录条目过少：${rows.length}`);

  const resources: GameResource[] = [];
  let skipped = 0;
  const ids = new Set<string>();
  for (const [index, value] of rows.entries()) {
    const row = record(value, `${kind} 第 ${index + 1} 条格式无效`);
    const id = resourceId(row["Id"], kind);
    const name = typeof row["Name"] === "string" ? row["Name"].trim() : "";
    if (!name) throw new Error(`${kind} ${id} 缺少中文名称`);
    const image = imageUrl(row[fields.image], kind);
    if (!image) {
      skipped += 1;
      continue;
    }
    if (ids.has(id)) throw new Error(`${kind} 目录出现重复 ID：${id}`);
    ids.add(id);
    resources.push({ kind, resourceId: id, name, imageUrl: image });
  }
  if (resources.length < minimumRecordCounts[kind]) throw new Error(`${kind} 可用图片条目过少：${resources.length}`);
  return { resources, skipped };
}

export function buildGameResourceCatalog(
  payloads: Record<GameResourceKind, unknown>,
  syncedAt = new Date().toISOString().slice(0, 10),
): BuiltGameResourceCatalog {
  const catalog: GameResource[] = [];
  const counts = {} as Record<GameResourceKind, number>;
  let skippedWithoutImage = 0;
  for (const kind of kindOrder) {
    const result = makeResources(kind, payloads[kind]);
    catalog.push(...result.resources);
    counts[kind] = result.resources.length;
    skippedWithoutImage += result.skipped;
  }
  catalog.sort((left, right) => {
    const kindDifference = kindOrder.indexOf(left.kind) - kindOrder.indexOf(right.kind);
    if (kindDifference) return kindDifference;
    const leftId = BigInt(left.resourceId);
    const rightId = BigInt(right.resourceId);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
  return {
    metadata: {
      sourceName: "Encore 鸣潮公开数据 API",
      sourceUrl,
      syncedAt,
      endpoints,
      counts,
      total: catalog.length,
      skippedWithoutImage,
    },
    catalog,
  };
}

const resolverSource = `
const resourcesById = new Map<string, GameResource[]>();
const resourcesByName = new Map<string, GameResource[]>();

function nameKey(name: string): string {
  return name.normalize("NFKC").trim().replace(/\\s+/gu, "").toLocaleLowerCase("zh-CN");
}

for (const resource of gameResourceCatalog) {
  const idGroup = resourcesById.get(resource.resourceId) ?? [];
  idGroup.push(resource);
  resourcesById.set(resource.resourceId, idGroup);

  const key = nameKey(resource.name);
  const nameGroup = resourcesByName.get(key) ?? [];
  nameGroup.push(resource);
  resourcesByName.set(key, nameGroup);
}

export function lookupGameResource(query: string | number, kind?: GameResourceKind): GameResource | undefined {
  const value = String(query).trim();
  if (!value) return undefined;
  const matches = /^\\d+$/u.test(value) ? resourcesById.get(value) : resourcesByName.get(nameKey(value));
  return matches?.find((resource) => !kind || resource.kind === kind);
}

export function lookupGameResourcesByName(name: string, kind?: GameResourceKind): readonly GameResource[] {
  const key = nameKey(name);
  if (!key) return [];
  const matches = resourcesByName.get(key) ?? [];
  return matches.filter((resource) => !kind || resource.kind === kind);
}

export function lookupGameResourcesById(resourceId: string | number, kind?: GameResourceKind): readonly GameResource[] {
  const id = String(resourceId).trim();
  if (!/^\\d+$/u.test(id)) return [];
  const matches = resourcesById.get(id) ?? [];
  return matches.filter((resource) => !kind || resource.kind === kind);
}
`.trim();

export function renderGameResourceCatalogSource(built: BuiltGameResourceCatalog): string {
  return [
    "// Generated by bun run scripts/sync-game-images.ts. Do not edit this file by hand.",
    "export type GameResourceKind = \"character\" | \"weapon\" | \"echo\" | \"item\";",
    "",
    "export interface GameResource {",
    "  kind: GameResourceKind;",
    "  resourceId: string;",
    "  name: string;",
    "  imageUrl: string;",
    "}",
    "",
    "export interface GameResourceCatalogMetadata {",
    "  sourceName: string;",
    "  sourceUrl: string;",
    "  syncedAt: string;",
    "  endpoints: Record<GameResourceKind, string>;",
    "  counts: Record<GameResourceKind, number>;",
    "  total: number;",
    "  skippedWithoutImage: number;",
    "}",
    "",
    `export const gameResourceCatalogMetadata: GameResourceCatalogMetadata = ${JSON.stringify(built.metadata, null, 2)} as const;`,
    "",
    `export const gameResourceCatalog: readonly GameResource[] = ${JSON.stringify(built.catalog, null, 2)} as const;`,
    "",
    resolverSource,
    "",
  ].join("\n");
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`读取 ${url} 失败：HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

async function syncGameResourceCatalog(): Promise<void> {
  const [character, weapon, echo, item] = await Promise.all(kindOrder.map((kind) => fetchJson(endpoints[kind])));
  const built = buildGameResourceCatalog({ character, weapon, echo, item });
  const target = resolve(import.meta.dir, "../src/kujiequ/resource-catalog.ts");
  await writeFile(target, renderGameResourceCatalogSource(built), "utf8");
  const counts = kindOrder.map((kind) => `${kind} ${built.metadata.counts[kind]}`).join(" · ");
  console.log(`已更新 ${target}：${counts} · 合计 ${built.metadata.total} 条 · 无图跳过 ${built.metadata.skippedWithoutImage} 条 · ${built.metadata.syncedAt}`);
}

if (import.meta.main) await syncGameResourceCatalog();
