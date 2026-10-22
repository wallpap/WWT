import type { GameLaunchPlan, GameSettings } from "./model.ts";

type PrepareLaunch = (path: string, tier: GameSettings["resourceTier"]) => GameLaunchPlan;
type ExecuteLaunch = (plan: GameLaunchPlan) => void;

function samePlan(left: GameLaunchPlan, right: GameLaunchPlan): boolean {
  return left.executablePath === right.executablePath && left.workingDirectory === right.workingDirectory && left.resourceTier === right.resourceTier && left.arguments[0] === right.arguments[0];
}

export class LaunchWorkflow {
  #preview: GameLaunchPlan | null = null;
  #confirmed: GameLaunchPlan | null = null;

  constructor(
    private readonly prepare: PrepareLaunch,
    private readonly execute: ExecuteLaunch,
  ) {}

  preview(path: string, tier: GameSettings["resourceTier"]): GameLaunchPlan {
    const plan = this.prepare(path, tier);
    this.#preview = plan;
    this.#confirmed = null;
    return plan;
  }

  confirm(path: string, tier: GameSettings["resourceTier"]): GameLaunchPlan {
    if (this.#preview === null) throw new Error("请先预览启动计划");
    const current = this.prepare(path, tier);
    if (!samePlan(this.#preview, current)) {
      this.#preview = null;
      this.#confirmed = null;
      throw new Error("启动目标或资源档位已变化，请重新预览并确认");
    }
    this.#confirmed = current;
    return current;
  }

  launch(path: string, tier: GameSettings["resourceTier"]): GameLaunchPlan {
    if (this.#confirmed === null) throw new Error("尚未确认启动计划，未启动游戏");
    const current = this.prepare(path, tier);
    if (!samePlan(this.#confirmed, current)) {
      this.#preview = null;
      this.#confirmed = null;
      throw new Error("启动目标或资源档位已变化，请重新预览并确认");
    }
    this.#confirmed = null;
    this.#preview = null;
    this.execute(current);
    return current;
  }
}
