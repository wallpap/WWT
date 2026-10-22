import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ResourceDownloadCache } from "../../src/game/resource-download.ts";
import { installResourceManifest } from "../../src/game/resource-installation.ts";
import type { OfficialResourceFile, OfficialResourceManifest } from "../../src/game/official-resources.ts";

const file: OfficialResourceFile = {
  path: "a.dat",
  size: 6,
  md5: createHash("md5").update("abcdef").digest("hex"),
  url: "https://example.invalid/a",
};
const partialBody = () =>
  new ReadableStream<Uint8Array>({
    start(stream) {
      stream.enqueue(new TextEncoder().encode("abc"));
      stream.enqueue(new TextEncoder().encode("def"));
      stream.close();
    },
  });

async function interrupt(cache: ResourceDownloadCache, resource = file): Promise<void> {
  const controller = new AbortController();
  await expect(
    cache.download(resource, {
      signal: controller.signal,
      fetcher: async () => new Response(partialBody(), { headers: { ETag: '"version-1"' } }),
      onBytes: (bytes) => {
        if (bytes === 3) controller.abort(new Error("paused"));
      },
    }),
  ).rejects.toThrow("paused");
}

test("restarting resumes the verified partial range and reuses a complete cache without a network request", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-resume-"));
  try {
    await interrupt(new ResourceDownloadCache(root));
    const cache = new ResourceDownloadCache(root);
    const progress: number[] = [];
    const ready = await cache.download(file, {
      fetcher: async (_url, options) => {
        expect(new Headers(options?.headers).get("Range")).toBe("bytes=3-");
        expect(new Headers(options?.headers).get("If-Range")).toBe('"version-1"');
        return new Response("def", {
          status: 206,
          headers: { "Content-Range": "bytes 3-5/6", ETag: '"version-1"' },
        });
      },
      onBytes: (bytes) => {
        progress.push(bytes);
      },
    });
    expect(await readFile(ready, "utf8")).toBe("abcdef");
    expect(progress[0]).toBe(3);
    expect(progress.at(-1)).toBe(6);
    expect(
      await new ResourceDownloadCache(root).download(file, {
        fetcher: async () => {
          throw new Error("unexpected network");
        },
      }),
    ).toBe(ready);
    await writeFile(ready, "broken");
    let fetched = false;
    await cache.download(file, {
      fetcher: async () => {
        fetched = true;
        return new Response("abcdef");
      },
    });
    expect(fetched).toBe(true);
    await cache.discard(file);
    expect(await Bun.file(ready).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a server that ignores Range restarts the file and an invalid range never appends unrelated bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-range-fallback-"));
  try {
    const cache = new ResourceDownloadCache(root);
    await interrupt(cache);
    await expect(
      cache.download(file, {
        fetcher: async () =>
          new Response("xxx", {
            status: 206,
            headers: { "Content-Range": "bytes 0-2/6" },
          }),
      }),
    ).rejects.toThrow("范围不符");
    expect(
      await readFile(
        join(
          root,
          (await readdir(root)).find((name) => name.endsWith(".part"))!,
        ),
        "utf8",
      ),
    ).toBe("abc");
    const ready = await cache.download(file, {
      fetcher: async () => new Response("abcdef"),
    });
    expect(await readFile(ready, "utf8")).toBe("abcdef");
    await cache.discard(file);
    await interrupt(cache, { ...file, md5: null });
    let attempts = 0;
    const changed = await cache.download(
      { ...file, md5: null },
      {
        fetcher: async (_url, options) => {
          attempts++;
          if (attempts === 1)
            return new Response("XYZ", {
              status: 206,
              headers: { "Content-Range": "bytes 3-5/6", ETag: '"version-2"' },
            });
          expect(new Headers(options?.headers).has("Range")).toBe(false);
          return new Response("uvwxyz", { headers: { ETag: '"version-2"' } });
        },
      },
    );
    expect(attempts).toBe(2);
    expect(await readFile(changed, "utf8")).toBe("uvwxyz");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("transient failures retry within a bounded budget and corrupt content never becomes ready", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-download-retry-"));
  try {
    const cache = new ResourceDownloadCache(root);
    let attempts = 0;
    await cache.download(file, {
      fetcher: async () => {
        attempts++;
        return attempts < 3 ? new Response("", { status: 503 }) : new Response("abcdef");
      },
    });
    expect(attempts).toBe(3);
    await cache.discard(file);
    attempts = 0;
    await expect(
      cache.download(file, {
        fetcher: async () => {
          attempts++;
          return new Response("broken");
        },
      }),
    ).rejects.toThrow("MD5");
    expect(attempts).toBe(3);
    expect((await readdir(root)).filter((name) => name.endsWith(".ready") || name.endsWith(".part"))).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installation cancellation preserves resumable bytes and keeps version metadata unchanged until completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-install-resume-"));
  const controller = new AbortController();
  const manifest: OfficialResourceManifest = {
    source: "mainland",
    version: "2",
    predownload: false,
    files: [file],
    totalBytes: file.size,
  };
  try {
    await writeFile(join(root, "a.dat"), "old");
    await writeFile(join(root, "launcherDownloadConfig.json"), '{"version":"1"}');
    await expect(
      installResourceManifest(root, [file], manifest, {
        signal: controller.signal,
        fetcher: async () => new Response(partialBody()),
        onProgress: (progress) => {
          if (progress.path === "a.dat" && progress.completedBytes === 3) controller.abort(new Error("paused"));
        },
      }),
    ).rejects.toThrow("paused");
    expect(await readFile(join(root, "a.dat"), "utf8")).toBe("old");
    expect(await readFile(join(root, "launcherDownloadConfig.json"), "utf8")).toBe('{"version":"1"}');
    await installResourceManifest(root, [file], manifest, {
      fetcher: async (_url, options) => {
        expect(new Headers(options?.headers).get("Range")).toBe("bytes=3-");
        return new Response("def", {
          status: 206,
          headers: { "Content-Range": "bytes 3-5/6" },
        });
      },
    });
    expect(await readFile(join(root, "a.dat"), "utf8")).toBe("abcdef");
    expect(JSON.parse(await readFile(join(root, "launcherDownloadConfig.json"), "utf8"))).toMatchObject({ version: "2" });
    expect((await readdir(root)).filter((name) => name.startsWith(".wwt-"))).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
