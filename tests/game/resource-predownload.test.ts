import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { predownloadResources } from "../../src/game/resource-predownload.ts";
import { installResourceManifest } from "../../src/game/resource-installation.ts";
import type { OfficialResourceManifest } from "../../src/game/official-resources.ts";

test("predownload caches and resumes future resources without changing the running version, then reuses them on release", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-predownload-"));
  const manifest: OfficialResourceManifest = {
    source: "mainland",
    version: "2",
    predownload: true,
    totalBytes: 6,
    files: [
      {
        path: "Client/a.pak",
        size: 6,
        md5: createHash("md5").update("abcdef").digest("hex"),
        url: "https://example.invalid/a",
      },
    ],
  };
  try {
    await writeFile(join(root, "Game.exe"), "original-executable");
    await writeFile(join(root, "launcherDownloadConfig.json"), '{"version":"1"}');
    const controller = new AbortController();
    await expect(
      predownloadResources(root, manifest.files, manifest, {
        signal: controller.signal,
        fetcher: async () =>
          new Response(
            new ReadableStream({
              start(stream) {
                stream.enqueue(new TextEncoder().encode("abc"));
                stream.enqueue(new TextEncoder().encode("def"));
                stream.close();
              },
            }),
          ),
        onProgress: (progress) => {
          if (progress.completedBytes === 3) controller.abort(new Error("paused"));
        },
      }),
    ).rejects.toThrow("paused");
    expect(await readFile(join(root, "Game.exe"), "utf8")).toBe("original-executable");
    expect(await readFile(join(root, "launcherDownloadConfig.json"), "utf8")).toBe('{"version":"1"}');
    expect(await Bun.file(join(root, "Client/a.pak")).exists()).toBe(false);
    const result = await predownloadResources(root, manifest.files, manifest, {
      fetcher: async (_url, options) => {
        expect(new Headers(options?.headers).get("Range")).toBe("bytes=3-");
        return new Response("def", {
          status: 206,
          headers: { "Content-Range": "bytes 3-5/6" },
        });
      },
    });
    expect(result.installedFiles).toBe(0);
    expect(JSON.parse(await readFile(join(root, ".wwt-predownload.json"), "utf8"))).toMatchObject({ source: "mainland", version: "2" });
    expect(await Bun.file(join(root, "Client/a.pak")).exists()).toBe(false);
    expect(await readFile(join(root, "launcherDownloadConfig.json"), "utf8")).toBe('{"version":"1"}');
    const unexpected = async () => {
      throw new Error("unexpected download");
    };
    await predownloadResources(root, manifest.files, manifest, {
      fetcher: unexpected,
    });
    await installResourceManifest(root, manifest.files, { ...manifest, predownload: false }, { fetcher: unexpected });
    expect(await readFile(join(root, "Client/a.pak"), "utf8")).toBe("abcdef");
    expect(JSON.parse(await readFile(join(root, "launcherDownloadConfig.json"), "utf8"))).toMatchObject({ version: "2" });
    expect((await readdir(root)).filter((name) => name.startsWith(".wwt-"))).toEqual([]);
    await expect(
      predownloadResources(root, manifest.files, {
        ...manifest,
        predownload: false,
      }),
    ).rejects.toThrow("预下载清单");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
