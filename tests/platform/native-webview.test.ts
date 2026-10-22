import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
const runNative = process.platform === "win32" && process.env["WWT_TEST_NATIVE"] === "1";

test.skipIf(!runNative)(
  "startup bridge delivers replies and timers after bulk binding in a Promise task",
  async () => {
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "fixtures/startup-bindings-probe.ts")], { stdout: "pipe", stderr: "pipe" });
    const watchdog = setTimeout(() => child.kill(), 8000);
    try {
      const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(JSON.parse(stdout)).toEqual({ ready: true, timer: true });
    } finally {
      clearTimeout(watchdog);
      if (child.exitCode === null) {
        child.kill();
        await child.exited;
      }
    }
  },
  10_000,
);

test.skipIf(!runNative)(
  "gacha history displays complete intervals and pages all five-star records",
  async () => {
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "fixtures/gacha-history-probe.ts")], { stdout: "pipe", stderr: "pipe" });
    const watchdog = setTimeout(() => child.kill(), 25_000);
    try {
      const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(JSON.parse(stdout)).toEqual({
        complete: true,
        firstPage: true,
        secondPage: true,
        isolated: true,
        overview: true,
        cardNavigation: true,
        keyboardTabs: true,
      });
    } finally {
      clearTimeout(watchdog);
      if (child.exitCode === null) {
        child.kill();
        await child.exited;
      }
    }
  },
  30_000,
);

test.skipIf(!runNative)(
  "migration controls preview XLSX identity and merge repeat imports in the real page",
  async () => {
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "fixtures/migration-controls-probe.ts")], { stdout: "pipe", stderr: "pipe" });
    const watchdog = setTimeout(() => child.kill(), 12_000);
    try {
      const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(JSON.parse(stdout)).toEqual({
        previewed: true,
        invalidated: true,
        changed: 2,
        records: 2,
        pulls: 3,
        player: "200000002",
      });
    } finally {
      clearTimeout(watchdog);
      if (child.exitCode === null) {
        child.kill();
        await child.exited;
      }
    }
  },
  15_000,
);

test.skipIf(!runNative)(
  "Kuro role, briefing, challenge and calculator controls work in the real page",
  async () => {
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "fixtures/kuro-data-controls-probe.ts")], { stdout: "pipe", stderr: "pipe" });
    const watchdog = setTimeout(() => child.kill(), 12_000);
    try {
      const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(JSON.parse(stdout)).toEqual({
        roleLoaded: true,
        roleReloaded: true,
        briefingSelection: true,
        briefingRefresh: true,
        briefingEmpty: true,
        forcedBriefings: 1,
        challengeTitles: true,
        floorStars: true,
        challengeCleared: true,
        calculatorRendered: true,
        calculatorTargets: true,
      });
    } finally {
      clearTimeout(watchdog);
      if (child.exitCode === null) {
        child.kill();
        await child.exited;
      }
    }
  },
  15_000,
);

test.skipIf(!runNative)(
  "Kuro account switching, daily data and explicit sign controls work in native WebView",
  async () => {
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "fixtures/kuro-controls-probe.ts")], { stdout: "pipe", stderr: "pipe" });
    const watchdog = setTimeout(() => child.kill(), 12_000);
    try {
      const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(JSON.parse(stdout)).toEqual({
        staleIgnored: true,
        noAutoSign: true,
        signedDisabled: true,
        previewVisible: true,
        credentialsCleared: true,
        loginTabs: true,
        keyboardTabs: true,
        tokenLogin: true,
        writes: 1,
        batchWrites: 1,
      });
    } finally {
      clearTimeout(watchdog);
      if (child.exitCode === null) {
        child.kill();
        await child.exited;
      }
    }
  },
  15_000,
);

test.skipIf(!runNative)(
  "launcher and update goals work in native WebView at desktop and narrow widths",
  async () => {
    for (const width of [1180, 700]) {
      const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "fixtures/game-controls-probe.ts"), String(width)], { stdout: "pipe", stderr: "pipe" });
      const watchdog = setTimeout(() => child.kill(), 10_000);
      try {
        const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        expect(JSON.parse(stdout)).toEqual({
          launches: 1,
          confirmations: 1,
          installs: 1,
          launcherFits: true,
          idleProgressHidden: true,
          noPrematureInstall: true,
          summaryVisible: true,
          noOverflow: true,
        });
      } finally {
        clearTimeout(watchdog);
        if (child.exitCode === null) {
          child.kill();
          await child.exited;
        }
      }
    }
  },
  25_000,
);

test.skipIf(!runNative)(
  "sidebar stays in place and quick navigation supports search, keyboard selection and focus restoration",
  async () => {
    const directory = await mkdtemp(join(resolve(import.meta.dir, "../../.build"), "navigation-test-"));
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "fixtures/navigation-probe.ts")], { cwd: directory, stdout: "pipe", stderr: "pipe" });
    const watchdog = setTimeout(() => child.kill(), 12_000);
    try {
      const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(JSON.parse(stdout)).toEqual({
        scrolled: true,
        sidebarFixed: true,
        pageChanged: true,
        reset: true,
        active: true,
        home: true,
        noHash: true,
        quickOpened: true,
        quickFiltered: true,
        quickNavigated: true,
        quickEmpty: true,
        quickWraps: true,
        quickClosed: true,
      });
    } finally {
      clearTimeout(watchdog);
      if (child.exitCode === null) {
        child.kill();
        await child.exited;
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
  15_000,
);

test.skipIf(!runNative)(
  "native bridge completes async I/O and process callbacks before the window closes",
  async () => {
    const buildDirectory = resolve(import.meta.dir, "../../.build");
    await mkdir(buildDirectory, { recursive: true });
    const directory = await mkdtemp(join(buildDirectory, "native-webview-test-"));
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "fixtures/native-webview-probe.ts"), directory], {
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
    });
    const watchdog = setTimeout(() => child.kill(), 12_000);
    try {
      const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
      const events = JSON.parse(stdout) as {
        name: string;
        running: boolean;
        value?: unknown;
      }[];
      for (const name of ["promise", "fs", "fetch", "process-exit", "timer", "syncProbe-reply", "promiseProbe-reply", "fsProbe-reply", "fetchProbe-reply", "evaluated"]) {
        expect(events.find((event) => event.name === name)?.running, name).toBe(true);
      }
      expect(events.find((event) => event.name === "error-reply")?.value).toEqual({ message: "specific-native-error", isError: false });
      expect(events.find((event) => event.name === "async-error-reply")?.value).toEqual({ message: "specific-async-error", isError: false });
      expect(events.find((event) => event.name === "cancel-request")?.value).toBe(true);
      expect(events.find((event) => event.name === "installation-cancelled")?.value).toEqual({ unchanged: true, clean: true, unlocked: true });
      expect(events.find((event) => event.name === "installCancelProbe-reply")?.value).toBe("cancelled");
      expect(events.find((event) => event.name === "stop")?.running).toBe(true);
    } finally {
      clearTimeout(watchdog);
      if (child.exitCode === null) {
        child.kill();
        await child.exited;
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
  15_000,
);
