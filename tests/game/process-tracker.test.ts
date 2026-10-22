import { describe, expect, test } from "bun:test";
import { GameProcessTracker } from "../../src/game/process-tracker.ts";
import type { GameLaunchPlan } from "../../src/game/model.ts";

const plan: GameLaunchPlan = {
  executablePath: "C:\\Game\\Wuthering Waves.exe",
  workingDirectory: "C:\\Game",
  resourceTier: "hd",
  arguments: ["-krqlv=hd"],
  availableTiers: ["hd"],
};

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve = (_value: T): void => {};
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("GameProcessTracker", () => {
  test("prevents duplicate launch until the tracked process exits", async () => {
    const exit = deferred<number>();
    let exitCode: number | null = null;
    let spawnCount = 0;
    const tracker = new GameProcessTracker(() => {
      spawnCount += 1;
      return {
        exited: exit.promise,
        get exitCode() {
          return exitCode;
        },
        unref() {},
      };
    });

    tracker.launch(plan);
    expect(tracker.isRunning).toBe(true);
    expect(() => tracker.launch(plan)).toThrow("仍在运行");
    exitCode = 0;
    exit.resolve(0);
    await exit.promise;
    await Promise.resolve();
    expect(tracker.isRunning).toBe(false);
    tracker.launch(plan);
    expect(spawnCount).toBe(2);
  });

  test("notifies listeners once with the tracked session interval", async () => {
    const exit = deferred<number>();
    let exitCode: number | null = null;
    const tracker = new GameProcessTracker(() => ({
      exited: exit.promise,
      get exitCode() {
        return exitCode;
      },
      unref() {},
    }));
    const sessions: { startedAt: number; endedAt: number }[] = [];
    tracker.onExit((session) => {
      sessions.push(session);
    });
    tracker.launch(plan);
    exitCode = 0;
    exit.resolve(0);
    await exit.promise;
    await Promise.resolve();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.endedAt).toBeGreaterThanOrEqual(sessions[0]?.startedAt ?? 0);
  });
});
