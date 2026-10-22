import { describe, expect, test } from "bun:test";
import { LaunchWorkflow } from "../../src/game/launch-workflow.ts";
import type { GameLaunchPlan, ResourceTier } from "../../src/game/model.ts";

const plan = (path: string, tier: ResourceTier = "hd"): GameLaunchPlan => ({
  executablePath: path,
  workingDirectory: "C:\\Game",
  resourceTier: tier,
  arguments: [`-krqlv=${tier}`],
  availableTiers: ["hd", "uhd"],
});

describe("LaunchWorkflow", () => {
  test("requires preview and confirmation, then consumes approval once", () => {
    const launched: GameLaunchPlan[] = [];
    const workflow = new LaunchWorkflow(
      (path, tier) => plan(path, tier === "auto" ? "hd" : tier),
      (value) => launched.push(value),
    );
    expect(() => workflow.confirm("game.exe", "hd")).toThrow("先预览");
    workflow.preview("game.exe", "hd");
    expect(() => workflow.launch("game.exe", "hd")).toThrow("尚未确认");
    workflow.confirm("game.exe", "hd");
    workflow.launch("game.exe", "hd");
    expect(launched).toHaveLength(1);
    expect(() => workflow.launch("game.exe", "hd")).toThrow("尚未确认");
  });

  test("revokes approval when the target or selected tier changes", () => {
    const workflow = new LaunchWorkflow(
      (path, tier) => plan(path, tier === "auto" ? "hd" : tier),
      () => {},
    );
    workflow.preview("game.exe", "hd");
    expect(() => workflow.confirm("other.exe", "hd")).toThrow("已变化");
    expect(() => workflow.confirm("game.exe", "hd")).toThrow("先预览");
  });
});
