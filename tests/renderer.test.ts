import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { buildBrowser } from "../scripts/browser-build.ts";
const rendererBuild = await buildBrowser({
  entrypoints: [fileURLToPath(new URL("../src/renderer.ts", import.meta.url))],
  format: "iife",
});
const script = await rendererBuild.outputs[0]!.text();

class Control {
  #value = "";
  options: { value: string }[] = [];
  constructor(private readonly isSelect = false) {}
  get value(): string {
    return this.#value;
  }
  set value(value: string) {
    this.#value = !this.isSelect || this.options.some((option) => option.value === value) ? value : "";
  }
  replaceChildren(...options: { value: string }[]): void {
    this.options = options;
    this.#value = options[0]?.value ?? "";
  }
  add(option: { value: string }): void {
    this.options.push(option);
  }
  hidden = false;
  disabled = false;
  textContent = "";
  dataset: Record<string, string> = {};
  readonly children: unknown[] = [];
  readonly attributes = new Map<string, string>();
  append(...children: unknown[]): void {
    this.children.push(...children);
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  readonly listeners = new Map<string, () => unknown>();
  addEventListener(event: string, listener: () => unknown): void {
    this.listeners.set(event, listener);
  }
  async fire(event: string): Promise<void> {
    await this.listeners.get(event)?.();
  }
  dispatchEvent(event: { type: string }): boolean {
    void this.fire(event.type);
    return true;
  }
}

function setup(preview: () => Promise<number> = async () => 1, overrides: Record<string, unknown> = {}) {
  const controls = new Map<string, Control>();
  const control = (id: string): Control => {
    let element = controls.get(id);
    if (!element) {
      element = new Control(id === "game-tier");
      if (id === "game-tier") element.replaceChildren({ value: "auto" });
      controls.set(id, element);
    }
    return element;
  };
  const pending = () => new Promise<never>(() => {});
  const files = [{ path: "a", size: 1, md5: null, url: "https://example.invalid/a" }];
  const bridge = {
    addEventListener: () => {},
    loadRecords: pending,
    loadGameTime: pending,
    loadGameSettings: pending,
    loadAppSettings: pending,
    updateAppSettings: async () => ({}),
    appUpdateInfo: pending,
    inspectLocalInstallation: async () => ({
      rootDirectory: "C:\\Game",
      version: "1",
      manifestPath: null,
      files: [],
      totalBytes: 0,
    }),
    fetchOfficialResources: async () => ({
      source: "mainland",
      version: "2",
      files,
      totalBytes: 1,
    }),
    planResourceUpdate: async () => ({
      entries: [{ path: "a", action: "download" }],
      downloadCount: 1,
      replaceCount: 0,
      unchangedCount: 0,
      extraLocalCount: 0,
      totalBytes: 1,
    }),
    inspectResources: async () => ({ availableTiers: ["hd", "uhd", "sd"] }),
    saveGameSettings: async () => {},
    previewResourceUpdate: preview,
    confirmResourceUpdate: async () => {},
    ...overrides,
  };
  runInNewContext(script, {
    document: {
      querySelector: (selector: string) => control(selector.slice(1)),
      querySelectorAll: () => [],
      createElement: (tag: string) => new Control(tag === "select"),
    },
    window: bridge,
    Option: class {
      constructor(
        readonly text: string,
        readonly value: string,
      ) {}
    },
    Event: class {
      constructor(readonly type: string) {}
    },
  });
  return control;
}

async function prepare(control: (id: string) => Control): Promise<void> {
  control("game-path").value = "C:\\Game\\Game.exe";
  control("resource-source").value = "mainland";
  await control("check-updates").fire("click");
}

describe("application update controls", () => {
  const release = {
    id: "offer-1",
    currentVersion: "0.1.0",
    source: "owner/project",
    available: true,
    release: {
      version: "0.2.0",
      notes: "release notes",
      asset: { size: 1024 },
    },
  };
  const defaults = {
    loadAppSettings: async () => ({
      appUpdateSource: "owner/project",
      checkAppUpdates: false,
    }),
    appUpdateInfo: async () => ({
      version: "0.1.0",
      portable: true,
      lastResult: null,
    }),
    checkAppUpdate: async () => release,
  };
  test("installation requires a verified package and changing the source discards it", async () => {
    let installs = 0;
    const control = setup(undefined, {
      ...defaults,
      prepareAppUpdate: async () => ({
        id: "offer-1",
        version: "0.2.0",
        fileCount: 6,
      }),
      installAppUpdate: async () => {
        installs++;
        throw new Error("worker unavailable");
      },
    });
    await Bun.sleep(0);
    expect(control("app-update-check").disabled).toBe(false);
    await control("app-update-check").fire("click");
    expect(control("app-update-download").disabled).toBe(false);
    expect(control("app-update-install").disabled).toBe(true);
    await control("app-update-install").fire("click");
    expect(installs).toBe(0);
    await control("app-update-download").fire("click");
    expect(control("app-update-install").disabled).toBe(false);
    await control("app-update-install").fire("click");
    expect(installs).toBe(1);
    expect(control("app-update-notice").textContent).toBe("worker unavailable");
    expect(control("app-update-install").disabled).toBe(false);
    control("app-update-source").value = "owner/another";
    await control("app-update-source").fire("input");
    expect(control("app-update-install").disabled).toBe(true);
    expect(control("app-update-download").disabled).toBe(true);
    await control("app-update-install").fire("click");
    expect(installs).toBe(1);
  });
  test("download cancellation waits for cleanup and keeps installation disabled", async () => {
    let reject!: (error: Error) => void;
    let cancels = 0;
    const control = setup(undefined, {
      ...defaults,
      prepareAppUpdate: () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
      cancelAppUpdate: async () => {
        cancels++;
      },
    });
    await Bun.sleep(0);
    await control("app-update-check").fire("click");
    const pending = control("app-update-download").fire("click");
    expect(control("app-update-check").disabled).toBe(true);
    expect(control("app-update-cancel").hidden).toBe(false);
    await control("app-update-cancel").fire("click");
    expect(cancels).toBe(1);
    expect(control("app-update-check").disabled).toBe(true);
    reject(new Error("download cancelled"));
    await pending;
    expect(control("app-update-notice").textContent).toBe("download cancelled");
    expect(control("app-update-install").disabled).toBe(true);
    expect(control("app-update-check").disabled).toBe(false);
    expect(control("app-update-progress").hidden).toBe(true);
  });
});

describe("goal-oriented launcher and resource controls", () => {
  test("checking a current game version does not run resource verification or create an update", async () => {
    let scans = 0;
    const control = setup(undefined, {
      inspectLocalInstallation: async () => ({
        rootDirectory: "C:\\Game",
        version: "2",
        executableExists: true,
        files: [],
      }),
      planResourceUpdate: async () => {
        scans++;
        throw new Error("unexpected full scan");
      },
    });
    await prepare(control);
    expect(scans).toBe(0);
    expect(control("install-resource-update").hidden).toBe(true);
    expect(control("resource-summary").textContent).toContain("资源已是最新");
  });

  test("explicit repair checks the official manifest and offers damaged files even at the current version", async () => {
    let repairMode: unknown, fromVersion: unknown;
    const control = setup(undefined, {
      inspectLocalInstallation: async () => ({
        rootDirectory: "C:\\Game",
        version: "2",
        executableExists: true,
        files: [],
      }),
      fetchOfficialResources: async (_source: unknown, _predownload: boolean, version: unknown) => {
        fromVersion = version;
        return { version: "2", files: [{ path: "a", size: 1 }] };
      },
      planResourceUpdate: async (_local: unknown, _official: unknown, _root: unknown, repair: unknown) => {
        repairMode = repair;
        return {
          entries: [{ path: "a", action: "replace" }],
          downloadCount: 0,
          replaceCount: 1,
          totalBytes: 1,
        };
      },
    });
    control("game-path").value = "C:\\Game\\Game.exe";
    await control("check-local-resources").fire("click");
    expect(fromVersion).toBeNull();
    expect(repairMode).toBe(true);
    expect(control("install-resource-update").hidden).toBe(false);
    expect(control("resource-notice").textContent).toContain("修复资源");
  });

  test("a missing executable or interrupted repair is repaired even if its version matches", async () => {
    for (const state of [
      { executableExists: false, state: "" },
      { executableExists: true, state: "repairing" },
    ]) {
      let repairMode: unknown;
      const control = setup(undefined, {
        inspectLocalInstallation: async () => ({
          rootDirectory: "C:\\Game",
          version: "2",
          files: [],
          ...state,
        }),
        planResourceUpdate: async (_local: unknown, _official: unknown, _root: unknown, repair: unknown) => {
          repairMode = repair;
          return {
            entries: [{ path: "a", action: "download" }],
            downloadCount: 1,
            replaceCount: 0,
            totalBytes: 1,
          };
        },
      });
      await prepare(control);
      expect(repairMode).toBe(true);
      expect(control("install-resource-update").hidden).toBe(false);
    }
  });

  test("a locally newer game is not offered a downgrade", async () => {
    let scans = 0;
    const control = setup(undefined, {
      inspectLocalInstallation: async () => ({
        rootDirectory: "C:\\Game",
        version: "10.0.0",
        executableExists: true,
        files: [],
      }),
      fetchOfficialResources: async () => ({ version: "2.0.0", files: [] }),
      planResourceUpdate: async () => {
        scans++;
        throw new Error("unexpected downgrade");
      },
    });
    await prepare(control);
    expect(scans).toBe(0);
    expect(control("install-resource-update").hidden).toBe(true);
  });

  test("an interrupted repair with intact files still offers the transaction that clears its state", async () => {
    let previews = 0;
    const control = setup(
      async () => {
        previews++;
        return 0;
      },
      {
        inspectLocalInstallation: async () => ({
          rootDirectory: "C:\\Game",
          version: "2",
          executableExists: true,
          state: "repairing",
          files: [],
        }),
        planResourceUpdate: async () => ({
          entries: [{ path: "a", action: "unchanged" }],
          downloadCount: 0,
          replaceCount: 0,
          totalBytes: 0,
        }),
      },
    );
    await prepare(control);
    expect(previews).toBe(1);
    expect(control("install-resource-update").hidden).toBe(false);
  });

  test("a new installation directory is saved before the usual resource plan and download flow", async () => {
    let saved = "";
    const control = setup(undefined, {
      pickGameInstallDirectory: async () => "D:\\NewGame\\Wuthering Waves.exe",
      saveGameSettings: async (path: string) => {
        saved = path;
      },
    });
    await control("browse-game-install").fire("click");
    expect(saved).toBe("D:\\NewGame\\Wuthering Waves.exe");
    expect(control("game-path").value).toBe(saved);
    expect(control("resource-purpose").value).toBe("current");
    expect(control("resource-notice").textContent).toContain("目录已选择");
    await control("check-updates").fire("click");
    expect(control("install-resource-update").hidden).toBe(false);
  });
  test("server operations lock launcher and updater controls and invalidate an earlier resource plan after switching", async () => {
    let finish!: (result: unknown) => void;
    let calls = 0;
    const status = {
      activeSource: "mainland",
      mainland: { ready: true, version: "1" },
      bilibili: { ready: true, version: "1" },
    };
    const control = setup(undefined, {
      runServerOperation: async (_path: string, action: string) => {
        calls++;
        return action === "apply"
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : { status };
      },
    });
    await prepare(control);
    control("server-switch-source").value = "bilibili";
    await control("server-switch-inspect").fire("click");
    expect(control("server-switch-apply").disabled).toBe(false);
    const switching = control("server-switch-apply").fire("click");
    expect(control("launch-game").disabled).toBe(true);
    expect(control("install-resource-update").disabled).toBe(true);
    expect(control("game-path").disabled).toBe(true);
    await control("server-switch-apply").fire("click");
    expect(calls).toBe(2);
    finish({ status: { ...status, activeSource: "bilibili" } });
    await switching;
    expect(control("launch-game").disabled).toBe(false);
    expect(control("install-resource-update").hidden).toBe(true);
    expect(control("server-switch-notice").textContent).toContain("切换完成");
  });
  test("predownload selects the future manifest and permits launching without reporting an installed version", async () => {
    let requested = false;
    let inspections = 0;
    let launches = 0;
    let finish!: (result: unknown) => void;
    const control = setup(undefined, {
      fetchOfficialResources: async (_source: unknown, predownload: boolean) => {
        requested = predownload;
        return {
          source: "mainland",
          version: "3",
          predownload,
          files: [{ path: "a", size: 1, md5: null, url: "https://example.invalid/a" }],
        };
      },
      inspectLocalInstallation: async () => {
        inspections++;
        return {
          rootDirectory: "C:\\Game",
          version: "2",
          files: [],
          totalBytes: 0,
        };
      },
      installResourceUpdate: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      launchGame: async () => {
        launches++;
      },
    });
    control("resource-purpose").value = "predownload";
    await prepare(control);
    expect(requested).toBe(true);
    expect(control("install-resource-update").textContent).toContain("开始预下载");
    const pending = control("install-resource-update").fire("click");
    await Bun.sleep(0);
    expect(control("launch-game").disabled).toBe(false);
    await control("launch-game").fire("click");
    expect(launches).toBe(1);
    finish({ installedFiles: 0, installedBytes: 0 });
    await pending;
    expect(control("resource-notice").textContent).toContain("预下载完成");
    expect(inspections).toBe(1);
    control("resource-purpose").value = "current";
    await control("resource-purpose").fire("change");
    expect(control("install-resource-update").hidden).toBe(true);
  });

  test("restores download preferences and ignores a late restore after the user changes channels", async () => {
    const restored = setup(undefined, {
      loadAppSettings: async () => ({
        downloadSource: "bilibili",
        downloadParallel: 8,
        downloadBytesPerSecond: 524288,
      }),
      loadGameSettings: async () => ({
        executablePath: "C:\\Game\\Game.exe",
        resourceTier: "hd",
      }),
    });
    await Bun.sleep(0);
    expect(restored("resource-source").value).toBe("bilibili");
    expect(restored("download-parallel").value).toBe("8");
    expect(restored("download-limit").value).toBe("0.5");
    expect(restored("game-path").value).toBe("C:\\Game\\Game.exe");
    let release!: (settings: unknown) => void;
    const control = setup(undefined, {
      loadAppSettings: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    control("resource-source").value = "bilibili";
    await control("resource-source").fire("change");
    release({
      downloadSource: "bilibili",
      downloadParallel: 8,
      downloadBytesPerSecond: 0,
    });
    await Bun.sleep(0);
    expect(control("resource-source").value).toBe("bilibili");
  });

  test("installation waits for download preferences to be saved", async () => {
    let saved!: unknown;
    let release!: () => void;
    let installs = 0;
    const control = setup(undefined, {
      updateAppSettings: async (patch: unknown) => {
        saved = patch;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      installResourceUpdate: async () => {
        installs++;
      },
    });
    await prepare(control);
    control("download-parallel").value = "2";
    control("download-limit").value = "0.5";
    await control("download-parallel").fire("change");
    const pending = control("install-resource-update").fire("click");
    await Bun.sleep(0);
    expect(saved).toEqual({
      downloadSource: "mainland",
      downloadParallel: 2,
      downloadBytesPerSecond: 524288,
    });
    expect(installs).toBe(0);
    release();
    await pending;
    expect(installs).toBe(1);
  });

  test("cancelling while confirmation is pending prevents the install from starting", async () => {
    let finish!: () => void;
    let installs = 0;
    const control = setup(undefined, {
      confirmResourceUpdate: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      cancelResourceUpdate: async () => false,
      installResourceUpdate: async () => {
        installs++;
      },
    });
    await prepare(control);
    const pending = control("install-resource-update").fire("click");
    await control("cancel-resource-update").fire("click");
    finish();
    await pending;
    expect(installs).toBe(0);
    expect(control("resource-notice").textContent).toContain("更新已取消");
    expect(control("check-updates").disabled).toBe(false);
  });

  test("starts the game with one click and ignores overlapping clicks", async () => {
    let finish!: () => void;
    let launches = 0;
    const control = setup(undefined, {
      launchGame: async () => {
        launches++;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
    });
    control("game-path").value = "C:\\Game\\Game.exe";
    const pending = control("launch-game").fire("click");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(control("launch-game").disabled).toBe(true);
    await control("launch-game").fire("click");
    finish();
    await pending;
    expect(launches).toBe(1);
    expect(control("launcher-notice").textContent).toContain("游戏已启动");
  });

  test("checks the full update flow once, then confirms and installs on the update click", async () => {
    const calls: string[] = [];
    const control = setup(
      async () => {
        calls.push("preview");
        return 1;
      },
      {
        confirmResourceUpdate: async () => {
          calls.push("confirm");
        },
        installResourceUpdate: async () => {
          calls.push("install");
          return { installedFiles: 1, installedBytes: 1 };
        },
      },
    );
    await prepare(control);
    expect(calls).toEqual(["preview"]);
    expect(control("install-resource-update").hidden).toBe(false);
    expect(control("installation-info").textContent).toContain("C:\\Game");
    await control("install-resource-update").fire("click");
    expect(calls).toEqual(["preview", "confirm", "install"]);
    expect(control("resource-notice").textContent).toContain("更新完成");
  });

  test("hides update and idle progress when all files are current", async () => {
    const control = setup(undefined, {
      inspectLocalInstallation: async () => ({
        rootDirectory: "C:\\Game",
        version: "2",
        files: [],
      }),
      planResourceUpdate: async () => ({
        entries: [{ path: "a", action: "unchanged" }],
        totalBytes: 0,
      }),
    });
    await prepare(control);
    expect(control("install-resource-update").hidden).toBe(true);
    expect(control("resource-progress-area").hidden).toBe(true);
    expect(control("resource-summary").textContent).toContain("资源已是最新");
  });

  test("an older version with matching files still offers the metadata transaction", async () => {
    let selected: unknown;
    const control = setup(async () => 0, {
      planResourceUpdate: async () => ({
        entries: [{ path: "a", action: "unchanged" }],
        downloadCount: 0,
        replaceCount: 0,
        totalBytes: 0,
      }),
      installResourceUpdate: async (_root: string, files: unknown) => {
        selected = files;
        return { installedFiles: 0, installedBytes: 0 };
      },
    });
    await prepare(control);
    expect(control("install-resource-update").hidden).toBe(false);
    await control("install-resource-update").fire("click");
    expect(selected).toEqual([]);
    expect(control("resource-notice").textContent).toContain("更新完成");
  });

  test("browsing saves the selected path and invalidates the update plan", async () => {
    let saved = "";
    const control = setup(undefined, {
      pickGameExecutable: async () => "D:\\Game\\Game.exe",
      saveGameSettings: async (path: string) => {
        saved = path;
      },
    });
    await prepare(control);
    await control("browse-game-path").fire("click");
    expect(saved).toBe("D:\\Game\\Game.exe");
    expect(control("game-path").value).toBe(saved);
    expect(control("install-resource-update").hidden).toBe(true);
  });

  test("restores the saved tier without requiring a launch preview", async () => {
    const control = setup(undefined, {
      loadGameSettings: async () => ({
        executablePath: "C:\\Game\\Game.exe",
        resourceTier: "uhd",
      }),
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(control("game-tier").value).toBe("uhd");
    expect(control("launch-game").disabled).toBe(false);
  });

  test("invalidates the update summary after a path or source change", async () => {
    for (const field of ["game-path", "resource-source", "resource-purpose"]) {
      const control = setup();
      await prepare(control);
      control(field).value = "changed";
      await control(field).fire(field === "game-path" ? "input" : "change");
      expect(control("install-resource-update").hidden).toBe(true);
      expect(control("resource-summary").hidden).toBe(true);
    }
  });

  test("ignores a check response after the channel changes", async () => {
    let complete!: (count: number) => void;
    const control = setup(
      () =>
        new Promise<number>((resolve) => {
          complete = resolve;
        }),
    );
    const pending = prepare(control);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    control("resource-source").value = "bilibili";
    await control("resource-source").fire("change");
    complete(1);
    await pending;
    expect(control("install-resource-update").hidden).toBe(true);
  });

  test("reports check errors locally and enables retry", async () => {
    const control = setup(undefined, {
      inspectLocalInstallation: async () => {
        throw { message: "目录不存在" };
      },
    });
    await prepare(control);
    expect(control("resource-notice").textContent).toContain("目录不存在");
    expect(control("check-updates").disabled).toBe(false);
  });

  test("keeps cancellation pending until cleanup and requires a fresh check", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    let fail!: (error: unknown) => void;
    let cancellations = 0;
    const control = setup(undefined, {
      addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
      installResourceUpdate: () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
      cancelResourceUpdate: async () => {
        cancellations++;
        return true;
      },
    });
    await prepare(control);
    const pending = control("install-resource-update").fire("click");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    listeners.get("resource-update-progress")!({
      detail: {
        path: "Client/a",
        completedFiles: 0,
        totalFiles: 2,
        completedBytes: 25,
        totalBytes: 100,
      },
    });
    expect(Number(control("resource-download-progress").value)).toBe(0.25);
    await control("cancel-resource-update").fire("click");
    await control("cancel-resource-update").fire("click");
    expect(cancellations).toBe(1);
    expect(control("game-path").disabled).toBe(true);
    expect(control("resource-download-status").textContent).toContain("等待文件清理");
    fail({ message: "资源安装已取消" });
    await pending;
    expect(control("resource-notice").textContent).toContain("资源安装已取消");
    expect(control("install-resource-update").hidden).toBe(true);
    expect(control("check-updates").disabled).toBe(false);
  });
});
