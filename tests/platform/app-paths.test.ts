import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { resolveAppPaths } from "../../src/platform/app-paths.ts";

describe("resolveAppPaths", () => {
  test("keeps portable data alongside the executable", () => {
    const paths = resolveAppPaths({
      standalone: true,
      executablePath: "D:/WWT/WWT.exe",
      projectDirectory: "E:/source/WWT",
    });

    expect(paths.rootDirectory).toBe("D:/WWT");
    expect(paths.dataDirectory).toBe(join("D:/WWT", "data"));
    expect(paths.gachaRecords).toBe(join("D:/WWT", "data", "gacha-records.json"));
    expect(paths.exportDirectory).toBe(join("D:/WWT", "data", "exports"));
  });

  test("keeps development data inside the project", () => {
    const paths = resolveAppPaths({
      standalone: false,
      executablePath: "C:/bun/bun.exe",
      projectDirectory: "E:/source/WWT",
    });

    expect(paths.rootDirectory).toBe(resolve("E:/source/WWT"));
    expect(paths.gachaRecords).toBe(join(resolve("E:/source/WWT"), "user-data", "gacha-records.json"));
  });
});
