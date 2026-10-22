import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkLocalResources } from "../../src/game/resource-check.ts";
import type { LocalResourceFile } from "../../src/game/local-manifest.ts";

describe("checkLocalResources", () => {
  test("reports valid, missing, size and hash mismatches without writing files", async () => {
    const root = await mkdtemp(join(tmpdir(), "wwt-check-"));
    try {
      await mkdir(join(root, "Client"), { recursive: true });
      await writeFile(join(root, "Client", "valid.dat"), "valid");
      await writeFile(join(root, "Client", "wrong.dat"), "wrong");
      await writeFile(join(root, "Client", "wrong-hash.dat"), "xxxxx");
      const files: LocalResourceFile[] = [
        {
          path: "Client/valid.dat",
          size: 5,
          md5: "9f7d0ee82b6a6ca7ddeae841f3253059",
          url: "",
        },
        { path: "Client/missing.dat", size: 2, md5: null, url: "" },
        { path: "Client/wrong.dat", size: 99, md5: null, url: "" },
        {
          path: "Client/wrong-hash.dat",
          size: 5,
          md5: "9f7d0ee82b6a6ca7ddeae841f3253059",
          url: "",
        },
      ];
      const result = await checkLocalResources(root, files);
      expect(result).toMatchObject({
        checkedCount: 4,
        validCount: 1,
        missingCount: 1,
        sizeMismatchCount: 1,
        hashMismatchCount: 1,
        uncheckedCount: 0,
      });
      expect(result.files.map((file) => file.state)).toEqual(["valid", "missing", "size-mismatch", "hash-mismatch"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("marks files without an expected hash as unchecked after size validation", async () => {
    const root = await mkdtemp(join(tmpdir(), "wwt-check-"));
    try {
      await writeFile(join(root, "file.dat"), "ok");
      const result = await checkLocalResources(root, [{ path: "file.dat", size: 2, md5: null, url: "" }]);
      expect(result.files[0]?.state).toBe("unchecked");
      expect(result.uncheckedCount).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
