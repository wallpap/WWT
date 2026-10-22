import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AppSettingsStore, defaultAppSettings, parseAppSettings } from "../../src/app/settings.ts";

test("theme preferences default to the system and persist across restarts without changing other settings", async () => {
  expect(parseAppSettings({}).theme).toBe("system");
  expect(() => parseAppSettings({ theme: "invalid" })).toThrow("theme");
  const directory = await mkdtemp(join(tmpdir(), "wwt-theme-"));
  try {
    const path = join(directory, "settings.json");
    const store = new AppSettingsStore(path);
    await store.update({ downloadParallel: 8, theme: "dark" });
    expect(await new AppSettingsStore(path).read()).toMatchObject({ theme: "dark", downloadParallel: 8 });
    await store.update({ theme: "light" });
    expect(await new AppSettingsStore(path).read()).toMatchObject({ theme: "light", downloadParallel: 8 });
    await store.update({ theme: "system" });
    expect((await new AppSettingsStore(path).read()).theme).toBe("system");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("download preferences persist and concurrent patches preserve other fields without replacing corrupt settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wwt-settings-"));
  const path = join(directory, "settings.json");
  try {
    const store = new AppSettingsStore(path);
    expect(await store.read()).toEqual(defaultAppSettings);
    await Promise.all([
      store.update({ downloadParallel: 8 }),
      store.update({
        downloadSource: "bilibili",
        downloadBytesPerSecond: 1048576,
      }),
    ]);
    expect(await new AppSettingsStore(path).read()).toEqual({
      ...defaultAppSettings,
      downloadParallel: 8,
      downloadSource: "bilibili",
      downloadBytesPerSecond: 1048576,
    });
    const before = await readFile(path);
    await expect(store.update({ downloadParallel: 0 })).rejects.toThrow("1—16");
    expect(await readFile(path)).toEqual(before);
    await writeFile(path, "broken");
    await expect(store.update({ downloadParallel: 2 })).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("broken");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("saving download preferences leaves unset desktop keys available for legacy migration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wwt-settings-explicit-"));
  try {
    const path = join(directory, "settings.json"),
      store = new AppSettingsStore(path);
    await store.update({ downloadParallel: 8 });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      downloadParallel: 8,
    });
    await store.importMissing({
      downloadParallel: 4,
      hideOnGameStart: true,
      startPage: "gacha",
    });
    expect(await store.read()).toMatchObject({
      downloadParallel: 8,
      hideOnGameStart: true,
      startPage: "gacha",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
