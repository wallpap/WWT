import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { detectServerSource, ServerSwitchService } from "../../src/game/server-switch.ts";
import type { OfficialResourceManifest, OfficialResourceSource } from "../../src/game/official-resources.ts";

const exe = "Client/Binaries/Win64/Client-Win64-Shipping.exe",
  sdk = "Client/Binaries/Win64/ThirdParty/KrPcSdk_Mainland",
  ace = "Client/Binaries/Win64/AntiCheatExpert";
const sets = {
  mainland: new Map([
    [exe, "mainland-exe"],
    [`${sdk}/KRSDKRes/KRSDKConfig.json`, "mainland-sdk"],
    [`${sdk}/common.dat`, "common"],
    [`${ace}/ace.dll`, "mainland-ace"],
  ]),
  bilibili: new Map([
    [exe, "bilibili-exe"],
    [`${sdk}/KRSDKRes/KRSDKConfig.json`, "bilibili-sdk"],
    [`${sdk}/common.dat`, "common"],
    [`${sdk}/KRSDKRes/Bilibili/PCGameSDK.dll`, "bilibili-marker"],
    [`${ace}/ace.dll`, "bilibili-ace"],
  ]),
};
const hash = (value: string): string => createHash("md5").update(value).digest("hex");
function manifest(source: OfficialResourceSource): OfficialResourceManifest {
  const rows = source === "bilibili" ? sets.bilibili : sets.mainland;
  const files = [...rows].map(([path, value]) => ({
    path,
    size: Buffer.byteLength(value),
    md5: hash(value),
    url: `https://example.invalid/${source}/${path}`,
  }));
  return {
    source,
    version: "3.6.0",
    predownload: false,
    files,
    totalBytes: files.reduce((sum, row) => sum + row.size, 0),
  };
}
async function createGame(root: string): Promise<void> {
  for (const [path, value] of sets.mainland) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), value);
  }
  await writeFile(join(root, "launcherDownloadConfig.json"), JSON.stringify({ appId: "10003", version: "3.6.0", custom: true }));
  await writeFile(join(root, "LocalGameResources.json"), "untouched-manifest");
}
test("server caches reuse verified files, switch both ways and preserve launcher version and unrelated resources", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-server-switch-"));
  let downloads = 0;
  const service = new ServerSwitchService(
    async (source) => manifest(source),
    () => false,
  );
  try {
    await createGame(root);
    expect(await detectServerSource(root)).toBe("mainland");
    await service.prepare(root, "bilibili", {
      fetcher: async (input) => {
        downloads++;
        const url = new URL(String(input));
        return new Response(sets.bilibili.get(decodeURI(url.pathname).slice("/bilibili/".length)));
      },
    });
    expect(downloads).toBe(4);
    expect(await detectServerSource(root)).toBe("mainland");
    expect((await service.inspect(root)).bilibili).toEqual({
      ready: true,
      version: "3.6.0",
    });
    await writeFile(join(root, "launcherDownloadConfig.json"), JSON.stringify({ appId: "10003", version: "3.7.0", custom: true }));
    await expect(service.apply(root, "bilibili")).rejects.toThrow("版本");
    expect(await readFile(join(root, exe), "utf8")).toBe("mainland-exe");
    await writeFile(join(root, "launcherDownloadConfig.json"), JSON.stringify({ appId: "10003", version: "3.6.0", custom: true }));
    await service.apply(root, "bilibili");
    expect(await detectServerSource(root)).toBe("bilibili");
    expect(await readFile(join(root, exe), "utf8")).toBe("bilibili-exe");
    expect(JSON.parse(await readFile(join(root, "launcherDownloadConfig.json"), "utf8"))).toEqual({ appId: "10004", version: "3.6.0", custom: true });
    expect((await service.inspect(root)).mainland.ready).toBe(true);
    await service.apply(root, "mainland");
    expect(await detectServerSource(root)).toBe("mainland");
    expect(await Bun.file(join(root, sdk, "KRSDKRes/Bilibili/PCGameSDK.dll")).exists()).toBe(false);
    expect(await readFile(join(root, exe), "utf8")).toBe("mainland-exe");
    expect(await readFile(join(root, "LocalGameResources.json"), "utf8")).toBe("untouched-manifest");
    await service.deleteCache(root, "bilibili");
    expect((await service.inspect(root)).bilibili.ready).toBe(false);
    expect(await readFile(join(root, exe), "utf8")).toBe("mainland-exe");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("repairs use the prepared target, reject corrupt caches and running games, and cancel before changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-server-repair-"));
  let running = false;
  const service = new ServerSwitchService(
    async (source) => manifest(source),
    () => running,
  );
  try {
    await createGame(root);
    await service.prepare(root, "mainland");
    await writeFile(join(root, exe), "damaged");
    await service.apply(root, "mainland");
    expect(await readFile(join(root, exe), "utf8")).toBe("mainland-exe");
    running = true;
    await expect(service.apply(root, "mainland")).rejects.toThrow("先退出游戏");
    running = false;
    const controller = new AbortController();
    controller.abort();
    await expect(service.apply(root, "mainland", { signal: controller.signal })).rejects.toThrow();
    await writeFile(join(root, ".wwt-server-cache/mainland", exe), "invalid");
    await expect(service.apply(root, "mainland")).rejects.toThrow("缓存损坏");
    expect(await readFile(join(root, exe), "utf8")).toBe("mainland-exe");
    await writeFile(join(root, "launcherDownloadConfig.json"), JSON.stringify({ appId: "50004" }));
    expect(await detectServerSource(root)).toBeNull();
    await mkdir(join(root, "Client/Binaries/Win64/ThirdParty/KrPcSdk_Global"), {
      recursive: true,
    });
    await expect(service.apply(root, "mainland")).rejects.toThrow("不属于国服");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
