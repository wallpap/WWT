import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { QueryCacheStore, type CachedQuery } from "../../src/kujiequ/query-cache.ts";

test("query cache serializes concurrent saves, preserves newer entries and rejects invalid writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-query-store-")),
    path = join(root, "cache.json");
  try {
    const store = new QueryCacheStore(path);
    const entry: CachedQuery = {
      scope: { userId: "12", roleId: "10001", serverId: "cn", source: "h5" },
      kind: "briefing",
      parameter: "",
      savedAt: 100,
      data: { weeks: [], months: [], versions: [] },
    };
    const save = (value: CachedQuery) => store.save(value.scope, value.kind, value.data, value.parameter, value.savedAt);
    await Promise.all([save(entry), save({ ...entry, scope: { ...entry.scope, userId: "13" } })]);
    expect(await store.read(entry.scope, "briefing")).not.toBeNull();
    expect(await store.read({ ...entry.scope, userId: "13" }, "briefing")).not.toBeNull();
    await save({ ...entry, savedAt: 99 });
    expect((await store.read(entry.scope, "briefing"))?.savedAt).toBe(100);
    const before = await readFile(path);
    await expect(
      save({ ...entry, parameter: "invalid" }),
    ).rejects.toThrow("参数");
    expect(await readFile(path)).toEqual(before);
    await writeFile(path, "broken");
    await expect(save(entry)).rejects.toThrow("读取本地业务缓存失败");
    expect(await readFile(path, "utf8")).toBe("broken");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
