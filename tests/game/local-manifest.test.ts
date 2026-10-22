import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectLocalInstallation } from "../../src/game/local-manifest.ts";

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "wwt-manifest-"));
  await mkdir(join(root, "Client"), { recursive: true });
  await writeFile(join(root, "Wuthering Waves.exe"), "fixture");
  return root;
}

describe("inspectLocalInstallation", () => {
  test("reads the original resource index and installed version without creating URLs", async () => {
    const root = await fixture();
    try {
      await writeFile(join(root, "launcherDownloadConfig.json"), JSON.stringify({ version: "3.7.0" }));
      await writeFile(
        join(root, "LocalGameResources.json"),
        JSON.stringify({
          resource: [
            {
              dest: "Client/a.pak",
              size: 12,
              md5: "0123456789abcdef0123456789abcdef",
            },
          ],
        }),
      );
      const result = await inspectLocalInstallation(join(root, "Wuthering Waves.exe"));
      expect(result.version).toBe("3.7.0");
      expect(result.files).toEqual([
        {
          path: "Client/a.pak",
          size: 12,
          md5: "0123456789abcdef0123456789abcdef",
          url: "",
        },
      ]);
      expect(result.totalBytes).toBe(12);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects unsafe and duplicate manifest paths", async () => {
    const root = await fixture();
    try {
      await writeFile(
        join(root, "manifest.json"),
        JSON.stringify({
          resource: [{ dest: "../outside", size: 1, md5: "" }],
        }),
      );
      await expect(inspectLocalInstallation(join(root, "Wuthering Waves.exe"))).rejects.toThrow("不安全路径");
      await writeFile(
        join(root, "manifest.json"),
        JSON.stringify({
          resource: [
            { dest: "a", size: 1, md5: "" },
            { dest: "A", size: 1, md5: "" },
          ],
        }),
      );
      await expect(inspectLocalInstallation(join(root, "Wuthering Waves.exe"))).rejects.toThrow("重复路径");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
