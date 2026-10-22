import { describe, expect, test } from "bun:test";
import { planResourceUpdate, planGameResourceUpdate, planInstalledResourceUpdate } from "../../src/game/resource-plan.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import type { LocalResourceFile } from "../../src/game/local-manifest.ts";
import type { OfficialResourceFile } from "../../src/game/official-resources.ts";

const local = (path: string, size: number, md5: string | null): LocalResourceFile => ({ path, size, md5, url: "" });
const official = (path: string, size: number, md5: string | null): OfficialResourceFile => ({
  path,
  size,
  md5,
  url: "https://example.invalid/" + path,
});

describe("planResourceUpdate", () => {
  test("incremental checks use the patch scope even when the legacy record omits unrelated resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "wwt-update-plan-"));
    try {
      const changed = official("changed.dat", 3, "a".repeat(32));
      const omitted = official("optional-sdk.dat", 200, "b".repeat(32));
      const patch = {
        fromVersion: "3.7.0",
        files: [changed],
        groups: [],
        deleteFiles: [],
      };
      const result = await planGameResourceUpdate(root, [], [changed, omitted], patch);
      expect(result.totalBytes).toBe(3);
      expect(result.entries.map((file) => file.path)).toEqual([changed.path]);
      const full = await planGameResourceUpdate(root, [], [changed, omitted]);
      expect(full.totalBytes).toBe(203);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("update planning reads metadata while explicit repair detects same-size corruption", async () => {
    const root = await mkdtemp(join(tmpdir(), "wwt-update-repair-"));
    try {
      const file = official("a.dat", 3, createHash("md5").update("new").digest("hex"));
      await writeFile(join(root, file.path), "bad");
      expect((await planGameResourceUpdate(root, [file], [file])).totalBytes).toBe(0);
      expect((await planInstalledResourceUpdate(root, [file], [file])).replaceCount).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("requires the size to match even when manifest hashes match", () => {
    const result = planResourceUpdate([local("a", 1, "a".repeat(32))], [official("a", 2, "a".repeat(32))]);
    expect(result.entries[0]?.action).toBe("replace");
  });

  test("classifies new, changed, matching and extra files without deleting anything", () => {
    const result = planResourceUpdate([local("a", 1, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), local("b", 1, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), local("extra", 2, null)], [official("a", 1, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), official("b", 2, "cccccccccccccccccccccccccccccccc"), official("c", 3, null)]);
    expect(result).toMatchObject({
      downloadCount: 1,
      replaceCount: 1,
      unchangedCount: 1,
      totalBytes: 5,
      extraLocalCount: 1,
    });
    expect(result.entries.map((entry) => entry.action)).toEqual(["unchanged", "replace", "download"]);
  });
});
