import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameImageCache } from "../../src/kujiequ/image-cache.ts";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const url = "https://web-static.kurobbs.com/fixture.png";

test("image downloads deduplicate and persist across restarts for offline use", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wwt-images-"));
  let requests = 0;
  const request = (async () => {
    requests++;
    return new Response(png);
  });
  try {
    const cache = new GameImageCache(directory, request);
    const [first, second] = await Promise.all([cache.load(url), cache.load(url)]);
    expect(first).toBe(`data:image/png;base64,${png.toString("base64")}`);
    expect(second).toBe(first);
    expect(requests).toBe(1);
    const offline = new GameImageCache(directory, (async () => { throw new Error("offline"); }));
    expect(await offline.load(url)).toBe(first);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid responses never become image cache entries and failed loads can retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wwt-images-"));
  let requests = 0;
  const cache = new GameImageCache(directory, (async () => new Response(++requests === 1 ? "<html>error</html>" : png)));
  try {
    await expect(cache.load(url)).rejects.toThrow("格式");
    expect(await cache.load(url)).toContain("data:image/png;base64,");
    await expect(cache.load("https://127.0.0.1/private")).rejects.toThrow("地址");
    await expect(cache.load("https://web-static.kurobbs.com.evil.invalid/x")).rejects.toThrow("地址");
    expect(requests).toBe(2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

