import type { GameLaunchPlan } from "./model.ts";

interface ProcessHandle {
  readonly exited: Promise<number>;
  readonly exitCode: number | null;
  unref(): void;
}

export interface TrackedGameSession {
  startedAt: number;
  endedAt: number;
}

type ExitListener = (session: TrackedGameSession) => void | Promise<void>;

type SpawnProcess = (plan: GameLaunchPlan) => ProcessHandle;

export class GameProcessTracker {
  #process: ProcessHandle | null = null;
  #startedAt: number | null = null;
  readonly #exitListeners = new Set<ExitListener>();

  constructor(private readonly spawn: SpawnProcess) {}

  get isRunning(): boolean {
    return this.#process !== null && this.#process.exitCode === null;
  }

  onExit(listener: ExitListener): () => void {
    this.#exitListeners.add(listener);
    return () => this.#exitListeners.delete(listener);
  }

  launch(plan: GameLaunchPlan): void {
    if (this.isRunning) throw new Error("本工具启动的游戏进程仍在运行，请先退出游戏");

    const processHandle = this.spawn(plan);
    this.#process = processHandle;
    const startedAt = Date.now();
    this.#startedAt = startedAt;
    void processHandle.exited.then(
      () => this.#finish(processHandle, startedAt),
      () => this.#finish(processHandle, startedAt),
    );
    processHandle.unref();
  }

  #clearIfCurrent(processHandle: ProcessHandle): void {
    if (this.#process === processHandle) {
      this.#process = null;
      this.#startedAt = null;
    }
  }

  #finish(processHandle: ProcessHandle, startedAt: number): void {
    if (this.#process !== processHandle || this.#startedAt !== startedAt) return;
    this.#clearIfCurrent(processHandle);
    const session = { startedAt, endedAt: Date.now() };
    for (const listener of this.#exitListeners) void listener(session);
  }
}
