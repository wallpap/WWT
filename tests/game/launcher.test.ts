import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { detectResourceTiers, inspectGameResources, prepareGameLaunch, validateGameExecutable } from "../../src/game/launcher.ts";

describe("validateGameExecutable", () => {
  test("rejects empty and non-executable paths", () => {
    expect(() => validateGameExecutable(" ")).toThrow("请先填写游戏可执行文件路径");
    expect(() => validateGameExecutable("C:\\Games\\Wuthering Waves\\config.json")).toThrow("必须指向 .exe");
  });

  test("accepts an existing executable", () => {
    const executable = join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "cmd.exe");
    expect(validateGameExecutable(executable)).toBe(executable);
  });

  test("requires a detected resource tier for the game launch plan", () => {
    const executable = join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "cmd.exe");
    expect(detectResourceTiers(executable)).toEqual([]);
    expect(() => prepareGameLaunch(executable, "auto")).toThrow("资源档位");
  });

  test("reports available and missing resource tiers", () => {
    const executable = join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "cmd.exe");
    const status = inspectGameResources(executable);
    expect(status.availableTiers).toEqual([]);
    expect(status.missingTiers).toEqual(["uhd", "hd", "sd"]);
  });
});
