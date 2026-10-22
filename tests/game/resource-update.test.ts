import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installOfficialResources } from "../../src/game/resource-update.ts";
import type { OfficialResourceFile } from "../../src/game/official-resources.ts";

const file = (path: string, body: string, md5: string | null): OfficialResourceFile => ({
  path,
  size: Buffer.byteLength(body),
  md5,
  url: `https://example.invalid/${path}`,
});
const fetcher =
  (responses: Record<string, string>, failingPath?: string): ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) =>
  async (input) => {
    const path = String(input).split("/").pop() ?? "";
    if (path === failingPath) return new Response("broken", { status: 500 });
    const body = responses[path];
    return body === undefined ? new Response("missing", { status: 404 }) : new Response(body, { status: 200 });
  };

describe("installOfficialResources", () => {
  test("reports partial bytes and cleans staging when cancelled during streaming", async () => {
    const root = await mkdtemp(join(tmpdir(), "wwt-cancel-"));
    const controller = new AbortController();
    const progress: number[] = [];
    try {
      await writeFile(join(root, "a.dat"), "old");
      await expect(
        installOfficialResources(root, [file("a.dat", "new-body", null)], {
          signal: controller.signal,
          fetcher: async (_input, init) => {
            expect(init?.signal).toBeInstanceOf(AbortSignal);
            expect(init?.signal?.aborted).toBe(false);
            return new Response(
              new ReadableStream({
                start(stream) {
                  stream.enqueue(new TextEncoder().encode("new"));
                  stream.enqueue(new TextEncoder().encode("-body"));
                  stream.close();
                },
              }),
            );
          },
          onProgress: ({ completedBytes }) => {
            progress.push(completedBytes);
            if (completedBytes > 0) controller.abort(new Error("用户取消"));
          },
        }),
      ).rejects.toThrow("用户取消");
      expect(progress).toContain(3);
      expect(await readFile(join(root, "a.dat"), "utf8")).toBe("old");
      expect(await readdir(root)).toEqual(["a.dat"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("cancellation after staging prevents replacement", async () => {
    const root = await mkdtemp(join(tmpdir(), "wwt-cancel-staged-"));
    const controller = new AbortController();
    try {
      await writeFile(join(root, "a.dat"), "old");
      await expect(
        installOfficialResources(root, [file("a.dat", "new", null)], {
          signal: controller.signal,
          fetcher: fetcher({ "a.dat": "new" }),
          onProgress: ({ completedFiles }) => {
            if (completedFiles === 1) controller.abort(new Error("用户取消"));
          },
        }),
      ).rejects.toThrow("用户取消");
      expect(await readFile(join(root, "a.dat"), "utf8")).toBe("old");
      expect(await readdir(root)).toEqual(["a.dat"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects directory junction ancestors without changing files outside the root", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "wwt-junction-"));
    const root = join(fixture, "game");
    const outside = join(fixture, "outside");
    try {
      await mkdir(root);
      await mkdir(outside);
      await writeFile(join(outside, "a.dat"), "old");
      await symlink(outside, join(root, "Client"), process.platform === "win32" ? "junction" : "dir");
      await expect(
        installOfficialResources(root, [file("Client/a.dat", "new", null)], {
          fetcher: fetcher({ "a.dat": "new" }),
        }),
      ).rejects.toThrow("符号链接");
      expect(await readFile(join(outside, "a.dat"), "utf8")).toBe("old");
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  test("does not replace an existing directory with a resource file", async () => {
    const root = await mkdtemp(join(tmpdir(), "wwt-directory-"));
    try {
      await mkdir(join(root, "Client"));
      await writeFile(join(root, "Client", "keep.dat"), "keep");
      await expect(
        installOfficialResources(root, [file("Client", "new", null)], {
          fetcher: fetcher({ Client: "new" }),
        }),
      ).rejects.toThrow();
      expect(await readFile(join(root, "Client", "keep.dat"), "utf8")).toBe("keep");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects Windows path aliases and duplicate or conflicting targets before download", async () => {
    const root = await mkdtemp(join(tmpdir(), "wwt-paths-"));
    let downloads = 0;
    const options = {
      fetcher: async () => {
        downloads += 1;
        return new Response("x");
      },
    };
    try {
      for (const path of ["Client/a:stream", "Client/a.", "Client/NUL", "Client/./a"]) {
        await expect(installOfficialResources(root, [file(path, "x", null)], options)).rejects.toThrow();
      }
      await expect(installOfficialResources(root, [file("a", "x", null), file("A", "x", null)], options)).rejects.toThrow();
      await expect(installOfficialResources(root, [file("Client", "x", null), file("Client/a", "x", null)], options)).rejects.toThrow();
      expect(downloads).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("restores replaced files when a later target becomes unwritable after staging", async () => {
    const root = await mkdtemp(join(tmpdir(), "wwt-rollback-"));
    try {
      await writeFile(join(root, "a.dat"), "old-a");
      const files = [file("a.dat", "new-a", null), file("Client/b.dat", "new-b", null)];
      await expect(
        installOfficialResources(root, files, {
          fetcher: fetcher({ "a.dat": "new-a", "b.dat": "new-b" }),
          onProgress: async ({ completedFiles }) => {
            if (completedFiles === 2) await writeFile(join(root, "Client"), "block");
          },
        }),
      ).rejects.toThrow();
      expect(await readFile(join(root, "a.dat"), "utf8")).toBe("old-a");
      expect(await readFile(join(root, "Client"), "utf8")).toBe("block");
      expect((await readdir(root)).filter((name) => name.startsWith(".wwt-"))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("downloads, verifies and atomically replaces files", async () => {
    const root = await mkdtemp(join(tmpdir(), "wwt-update-"));
    try {
      await writeFile(join(root, "existing.dat"), "old");
      const files = [file("existing.dat", "new", "22af645d1859cb5ca6da0c484f1f37ea"), file("Client/new.dat", "fresh", null)];
      const result = await installOfficialResources(root, files, {
        fetcher: fetcher({ "existing.dat": "new", "new.dat": "fresh" }),
      });
      expect(result).toEqual({ installedFiles: 2, installedBytes: 8 });
      expect(await readFile(join(root, "existing.dat"), "utf8")).toBe("new");
      expect(await readFile(join(root, "Client", "new.dat"), "utf8")).toBe("fresh");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("restores existing files when installation fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "wwt-update-"));
    try {
      await writeFile(join(root, "a.dat"), "old-a");
      await writeFile(join(root, "b.dat"), "old-b");
      const files = [file("a.dat", "new-a", null), file("b.dat", "new-b", null)];
      await expect(
        installOfficialResources(root, files, {
          fetcher: fetcher({ "a.dat": "new-a" }, "b.dat"),
        }),
      ).rejects.toThrow("下载失败");
      expect(await readFile(join(root, "a.dat"), "utf8")).toBe("old-a");
      expect(await readFile(join(root, "b.dat"), "utf8")).toBe("old-b");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects unsafe paths before writing", async () => {
    const root = await mkdtemp(join(tmpdir(), "wwt-update-"));
    try {
      await expect(
        installOfficialResources(root, [file("../outside.dat", "x", null)], {
          fetcher: fetcher({}),
        }),
      ).rejects.toThrow("不安全");
      await expect(stat(join(root, ".wwt-download-any"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
