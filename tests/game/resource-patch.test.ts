import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applyHpatchz, verifyHpatchz } from "../../src/game/hpatchz.ts";
import { installResourceManifest } from "../../src/game/resource-installation.ts";
import { parseOfficialPatch } from "../../src/game/official-patch.ts";
import { planPatchDownloads } from "../../src/game/resource-patch-plan.ts";
import { predownloadResources } from "../../src/game/resource-predownload.ts";
import type { OfficialResourceFile, OfficialResourceManifest } from "../../src/game/official-resources.ts";

const fixture = resolve(import.meta.dir, "fixtures/update.krdiff");
const oldBody = "old-content\n".repeat(1024);
const newBodies = new Map([
  ["Client/a.dat", "new-content\n".repeat(1024)],
  ["Client/shared.dat", "shared-content\n".repeat(1024)],
  ["Client/new.dat", "added-content\n".repeat(1024)],
]);
function resource(path: string, body: string | Buffer): OfficialResourceFile {
  return {
    path,
    size: Buffer.byteLength(body),
    md5: createHash("md5").update(body).digest("hex"),
    url: `https://example.invalid/full/${path}`,
  };
}
async function setup(root: string): Promise<OfficialResourceManifest> {
  await mkdir(join(root, "Client"));
  await writeFile(join(root, "Client/a.dat"), oldBody);
  await writeFile(join(root, "Client/shared.dat"), newBodies.get("Client/shared.dat")!);
  await writeFile(join(root, "Client/remove.dat"), "obsolete");
  await writeFile(join(root, "launcherDownloadConfig.json"), JSON.stringify({ version: "1.0.0", appId: "10003" }));
  const files = [...newBodies].map(([path, body]) => resource(path, body));
  const binary = resource("update.krdiff", await readFile(fixture));
  const patch = parseOfficialPatch(
    {
      patchInfos: [
        {
          dest: binary.path,
          entries: files.map((file) => ({ dest: file.path })),
        },
      ],
      deleteFiles: ["Client/remove.dat"],
    },
    "1.0.0",
    [binary],
    files,
  );
  return {
    source: "mainland",
    version: "1.1.0",
    files,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    predownload: false,
    patch,
  };
}

test("the pinned HPatchZ applies a real zstd directory fixture with unchanged files and rejects damaged old data", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-hpatch-"));
  try {
    await setup(root);
    const output = join(root, "output");
    await applyHpatchz(root, fixture, output);
    for (const [path, body] of newBodies) expect(await readFile(join(output, path), "utf8")).toBe(body);
    expect(await Bun.file(join(output, "Client/remove.dat")).exists()).toBe(false);
    await writeFile(join(root, "Client/a.dat"), "bad");
    await expect(applyHpatchz(root, fixture, join(root, "bad-output"))).rejects.toThrow("退出码");
    const altered = join(root, "hpatchz.exe");
    await writeFile(altered, "wrong component");
    await expect(verifyHpatchz(altered)).rejects.toThrow("组件校验失败");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a differential install downloads only the patch and commits output, deletions, manifest and version together", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-diff-install-"));
  try {
    const manifest = await setup(root);
    const files = manifest.files.filter((file) => file.path !== "Client/shared.dat");
    expect(planPatchDownloads(manifest.patch!, files).totalBytes).toBe((await readFile(fixture)).length);
    const requests: string[] = [];
    await installResourceManifest(root, files, manifest, {
      fetcher: async (input) => {
        requests.push(String(input));
        return new Response(await readFile(fixture));
      },
    });
    expect(requests).toEqual([manifest.patch!.files[0]!.url]);
    for (const [path, body] of newBodies) expect(await readFile(join(root, path), "utf8")).toBe(body);
    expect(await Bun.file(join(root, "Client/remove.dat")).exists()).toBe(false);
    expect(JSON.parse(await readFile(join(root, "launcherDownloadConfig.json"), "utf8"))).toMatchObject({ version: "1.1.0", appId: "10003" });
    expect(JSON.parse(await readFile(join(root, "LocalGameResources.json"), "utf8"))).toHaveProperty("resource");
    expect((await readdir(root)).some((name) => name.startsWith(".wwt-transaction-"))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("damaged old files or a mismatched patched output fall back to verified full resources", async () => {
  for (const damaged of [true, false]) {
    const root = await mkdtemp(join(tmpdir(), "wwt-diff-fallback-"));
    try {
      const manifest = await setup(root);
      if (damaged) await writeFile(join(root, "Client/a.dat"), "broken");
      else {
        const file = manifest.files.find((file) => file.path === "Client/a.dat")!;
        Object.assign(file, resource(file.path, "replacement\n".repeat(1024)));
      }
      const fetched: string[] = [];
      const result = await installResourceManifest(
        root,
        manifest.files.filter((file) => file.path !== "Client/shared.dat"),
        manifest,
        {
          fetcher: async (input) => {
            const url = String(input);
            fetched.push(url);
            if (url.endsWith(".krdiff")) return new Response(await readFile(fixture));
            const file = manifest.files.find((file) => file.url === url)!;
            return new Response(!damaged && file.path === "Client/a.dat" ? "replacement\n".repeat(1024) : newBodies.get(file.path)!);
          },
        },
      );
      expect(result.notice).toContain("完整文件");
      expect(fetched).toContain(manifest.files[0]!.url);
      expect(await readFile(join(root, "Client/a.dat"), "utf8")).toBe(damaged ? newBodies.get("Client/a.dat")! : "replacement\n".repeat(1024));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("cancelling before patch application preserves the old installation and reusable patch cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-diff-cancel-"));
  try {
    const manifest = await setup(root);
    const controller = new AbortController();
    await expect(
      installResourceManifest(
        root,
        manifest.files.filter((file) => file.path !== "Client/shared.dat"),
        manifest,
        {
          signal: controller.signal,
          fetcher: async () => new Response(await readFile(fixture)),
          onProgress: (progress) => {
            if (progress.phase === "patch") controller.abort(new Error("cancel patch"));
          },
        },
      ),
    ).rejects.toThrow("cancel patch");
    expect(await readFile(join(root, "Client/a.dat"), "utf8")).toBe(oldBody);
    expect(await readFile(join(root, "Client/remove.dat"), "utf8")).toBe("obsolete");
    expect(JSON.parse(await readFile(join(root, "launcherDownloadConfig.json"), "utf8")).version).toBe("1.0.0");
    expect((await readdir(join(root, ".wwt-download-cache"))).some((name) => name.endsWith(".ready"))).toBe(true);
    expect((await readdir(root)).some((name) => name.startsWith(".wwt-transaction-"))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("grouped predownload caches the patch without changing the game and reuses it after release", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-group-predownload-"));
  try {
    const manifest = await setup(root);
    const binary = manifest.patch!.files[0]!;
    manifest.patch = parseOfficialPatch(
      {
        groupInfos: [
          {
            dest: binary.path,
            dstFiles: manifest.files.map((file) => ({ dest: file.path })),
            srcFiles: [{ dest: "Client/remove.dat" }],
          },
        ],
      },
      "1.0.0",
      [binary],
      manifest.files,
    );
    const pending = manifest.files.filter((file) => file.path !== "Client/shared.dat");
    await predownloadResources(root, pending, { ...manifest, predownload: true }, { fetcher: async () => new Response(await readFile(fixture)) });
    expect(await readFile(join(root, "Client/a.dat"), "utf8")).toBe(oldBody);
    expect(JSON.parse(await readFile(join(root, ".wwt-predownload.json"), "utf8")).files[0].path).toBe("update.krdiff");
    await installResourceManifest(root, pending, manifest, {
      fetcher: async () => {
        throw new Error("unexpected network");
      },
    });
    expect(await readFile(join(root, "Client/a.dat"), "utf8")).toBe(newBodies.get("Client/a.dat")!);
    expect(await Bun.file(join(root, "Client/remove.dat")).exists()).toBe(false);
    expect(await Bun.file(join(root, ".wwt-predownload.json")).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
