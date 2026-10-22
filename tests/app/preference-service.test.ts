import { expect, test } from "bun:test";
import { PreferenceService } from "../../src/app/preference-service.ts";
import { defaultAppSettings, parseAppSettings, type AppSettings } from "../../src/app/settings.ts";
import { parseShortcut } from "../../src/app/shortcut.ts";

test("shortcut parsing normalizes supported combinations and rejects ambiguous or unmodified keys", () => {
  expect(parseShortcut(" alt + ctrl + w ")).toEqual({
    text: "Ctrl+Alt+W",
    modifiers: 0x4003,
    key: 87,
  });
  expect(parseShortcut("Win+F12")?.key).toBe(0x7b);
  expect(parseShortcut("")).toBeNull();
  for (const value of ["W", "Shift+W", "Ctrl+Ctrl+W", "Ctrl+Foo", "Alt+F25"]) expect(() => parseShortcut(value)).toThrow();
  expect(() => parseAppSettings({ hideOnGameStart: "true" })).toThrow("无效");
  expect(() => parseAppSettings({ uiScale: 200 })).toThrow("75—150");
});

test("preference failure restores desktop and startup behavior while later requests continue normally", async () => {
  let state: AppSettings = { ...defaultAppSettings },
    configured = state;
  const startup: boolean[] = [];
  let failed = false;
  const service = new PreferenceService(
    {
      read: async () => ({ ...state }),
      update: async (patch) => {
        if (!failed) {
          failed = true;
          throw new Error("save failed");
        }
        state = parseAppSettings({ ...state, ...patch });
        return { ...state };
      },
    },
    (next) => {
      configured = next;
    },
    async (value) => {
      startup.push(value);
    },
  );
  await expect(service.update({ startWithWindows: true, closeAction: "tray" })).rejects.toThrow("save failed");
  expect(startup).toEqual([true, false]);
  expect(configured.closeAction).toBe("exit");
  expect(state).toEqual(defaultAppSettings);
  await Promise.all([service.update({ showShortcut: "Ctrl+Alt+W" }), service.update({ hideOnGameStart: true })]);
  expect(state).toMatchObject({
    showShortcut: "Ctrl+Alt+W",
    hideOnGameStart: true,
  });
  expect(startup).toEqual([true, false]);
});

test("a conflicting desktop shortcut never writes settings or modifies startup registration", async () => {
  let writes = 0,
    startupChanges = 0;
  const service = new PreferenceService(
    {
      read: async () => ({ ...defaultAppSettings }),
      update: async () => {
        writes++;
        return { ...defaultAppSettings };
      },
    },
    (next) => {
      if (next.showShortcut) throw new Error("快捷键已被占用");
    },
    async () => {
      startupChanges++;
    },
  );
  await expect(service.update({ showShortcut: "Alt+W", startWithWindows: true })).rejects.toThrow("已被占用");
  expect(writes).toBe(0);
  expect(startupChanges).toBe(0);
});
