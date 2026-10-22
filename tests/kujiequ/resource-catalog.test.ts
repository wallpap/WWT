import { expect, test } from "bun:test";
import {
  gameResourceCatalog,
  gameResourceCatalogMetadata,
  lookupGameResource,
  lookupGameResourcesById,
  lookupGameResourcesByName,
} from "../../src/kujiequ/resource-catalog.ts";
import { buildGameResourceCatalog, renderGameResourceCatalogSource } from "../../scripts/sync-game-images.ts";

test("game resource catalog has indexed images across all resource groups", () => {
  expect(gameResourceCatalog).toHaveLength(gameResourceCatalogMetadata.total);
  expect(gameResourceCatalogMetadata).toMatchObject({
    sourceUrl: "https://api.encore.moe",
    syncedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    skippedWithoutImage: 1,
  });

  const seenIds = new Set<string>();
  const counts = { character: 0, weapon: 0, echo: 0, item: 0 };
  for (const resource of gameResourceCatalog) {
    const idKey = `${resource.kind}:${resource.resourceId}`;
    expect(seenIds.has(idKey)).toBe(false);
    seenIds.add(idKey);
    expect(resource.name.length).toBeGreaterThan(0);
    expect(new URL(resource.imageUrl).protocol).toBe("https:");
    counts[resource.kind] += 1;
  }
  expect(counts).toEqual(gameResourceCatalogMetadata.counts);
  expect(counts).toMatchObject({ character: expect.any(Number), weapon: expect.any(Number), echo: expect.any(Number), item: expect.any(Number) });
});

test("resource lookup accepts numeric IDs and Chinese names while retaining name collisions", () => {
  expect(lookupGameResource(1402, "character")).toMatchObject({
    resourceId: "1402",
    name: "秧秧",
    kind: "character",
  });
  expect(lookupGameResource("21010074", "weapon")?.name).toBe("纹秋");
  expect(lookupGameResource("  贝币 ", "item")?.resourceId).toBe("2");
  expect(lookupGameResource("不存在的资源")).toBeUndefined();

  const roverForms = lookupGameResourcesByName("漂泊者·衍射", "character");
  expect(roverForms.map((resource) => resource.resourceId).sort()).toEqual(["1501", "1502"]);
  expect(lookupGameResource("漂泊者·衍射", "character")?.resourceId).toBe("1501");
  expect(lookupGameResourcesById("1501", "character")).toEqual(roverForms.slice(0, 1));
});

test("sync normalizes all four API lists and refuses unexpectedly incomplete data", () => {
  const payloads = {
    character: { roleList: Array.from({ length: 50 }, (_, index) => ({ Id: 1000 + index, Name: `角色${index}`, RoleHeadIcon: `https://example.invalid/character/${index}.webp` })) },
    weapon: { weapons: Array.from({ length: 100 }, (_, index) => ({ Id: 2000 + index, Name: `武器${index}`, Icon: `https://example.invalid/weapon/${index}.webp` })) },
    echo: { Echo: Array.from({ length: 250 }, (_, index) => ({ Id: 3000 + index, Name: `声骸${index}`, Icon: `https://example.invalid/echo/${index}.webp` })) },
    item: { itemList: [
      ...Array.from({ length: 1_800 }, (_, index) => ({ Id: 4000 + index, Name: `材料${index}`, Icon: `https://example.invalid/item/${index}.webp` })),
      { Id: 5800, Name: "暂无图片材料", Icon: "" },
    ] },
  };
  const built = buildGameResourceCatalog(payloads, "2026-10-21");
  expect(built.metadata).toMatchObject({
    syncedAt: "2026-10-21",
    total: 2_200,
    skippedWithoutImage: 1,
    counts: { character: 50, weapon: 100, echo: 250, item: 1_800 },
  });
  expect(built.catalog[0]).toEqual({
    kind: "character",
    resourceId: "1000",
    name: "角色0",
    imageUrl: "https://example.invalid/character/0.webp",
  });
  expect(renderGameResourceCatalogSource(built)).toContain("export const gameResourceCatalog:");
  expect(() => buildGameResourceCatalog({ ...payloads, echo: { Echo: [] } }, "2026-10-21")).toThrow("条目过少");
});
