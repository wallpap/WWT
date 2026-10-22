import { expect, test } from "bun:test";
import { BandwidthLimiter, validateDownloadPolicy } from "../../src/game/download-policy.ts";
import { installOfficialResources } from "../../src/game/resource-update.ts";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { OfficialResourceFile } from "../../src/game/official-resources.ts";

test("parallel workers share the bandwidth budget and reject invalid policies", async () => {
  const waits: number[] = [];
  const limiter = new BandwidthLimiter(
    1000,
    () => 0,
    async (milliseconds) => {
      waits.push(milliseconds);
    },
  );
  await Promise.all([limiter.consume(100), limiter.consume(200)]);
  expect(waits).toEqual([100, 300]);
  for (const policy of [
    { parallel: 0, bytesPerSecond: 0 },
    { parallel: 17, bytesPerSecond: 0 },
    { parallel: 1.5, bytesPerSecond: 0 },
    { parallel: 2, bytesPerSecond: -1 },
  ])
    expect(() => validateDownloadPolicy(policy)).toThrow();
  const controller = new AbortController();
  controller.abort(new Error("paused"));
  await expect(limiter.consume(1, controller.signal)).rejects.toThrow("paused");
});

test("bounded concurrent downloads settle before cleanup and report aggregate progress", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-parallel-"));
  const files: OfficialResourceFile[] = Array.from({ length: 5 }, (_, index) => ({
    path: `${index}.dat`,
    size: 1,
    md5: null,
    url: `https://example.invalid/${index}`,
  }));
  try {
    let active = 0;
    let maximum = 0;
    const progress: number[] = [];
    await installOfficialResources(root, files, {
      parallel: 2,
      fetcher: async () => {
        active++;
        maximum = Math.max(maximum, active);
        await Bun.sleep(5);
        active--;
        return new Response("x");
      },
      onProgress: (update) => {
        progress.push(update.completedBytes);
      },
    });
    expect(maximum).toBe(2);
    expect(active).toBe(0);
    expect(progress.at(-1)).toBe(5);
    expect(progress.every((bytes) => bytes >= 0 && bytes <= 5)).toBe(true);
    expect(await readFile(join(root, "4.dat"), "utf8")).toBe("x");
    let waiting = 0;
    await expect(
      installOfficialResources(root, files, {
        parallel: 2,
        fetcher: async (url, options) => {
          if (String(url).endsWith("0")) {
            await Bun.sleep(10);
            return new Response("missing", { status: 404 });
          }
          waiting++;
          try {
            await new Promise<void>((_resolve, reject) => options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true }));
          } finally {
            waiting--;
          }
          return new Response("x");
        },
      }),
    ).rejects.toThrow("HTTP 404");
    expect(waiting).toBe(0);
    expect((await readdir(root)).filter((name) => name.startsWith(".wwt-"))).toEqual([]);
    expect(await readFile(join(root, "4.dat"), "utf8")).toBe("x");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
