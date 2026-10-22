import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installResourceManifest } from "../../src/game/resource-installation.ts";
import { inspectLocalInstallation } from "../../src/game/local-manifest.ts";
import { planResourceUpdate, planInstalledResourceUpdate } from "../../src/game/resource-plan.ts";
import type { OfficialResourceManifest } from "../../src/game/official-resources.ts";
import { prepareGameLaunch } from "../../src/game/launcher.ts";
import { createHash } from "node:crypto";

const manifest: OfficialResourceManifest = {
  source: "mainland",
  version: "2.0",
  predownload: false,
  totalBytes: 3,
  files: [{ path: "a.dat", size: 3, md5: null, url: "https://example.invalid/a" }],
};

test("a new installation can be planned without an executable and a missing executable can be repaired", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-fresh-install-"));
  try {
    const executable = join(root, "Wuthering Waves.exe");
    const initial = await inspectLocalInstallation(executable);
    expect(initial.files).toEqual([]);
    expect(initial.version).toBeNull();
    const files = ["Wuthering Waves.exe", "Client/Content/HD/fixture.pak"].map((path) => ({
      path,
      url: `https://example.invalid/${path}`,
      size: 3,
      md5: createHash("md5").update("new").digest("hex"),
    }));
    const official = { ...manifest, files, totalBytes: 6 };
    const plan = await planInstalledResourceUpdate(root, initial.files, files);
    expect(plan.downloadCount).toBe(2);
    await writeFile(join(root, "notes.txt"), "preserve");
    await installResourceManifest(root, files, official, {
      fetcher: async () => new Response("new"),
    });
    expect(prepareGameLaunch(executable, "auto").resourceTier).toBe("hd");
    await rm(executable);
    const broken = await inspectLocalInstallation(executable);
    expect(broken.version).toBe(official.version);
    const repair = await planInstalledResourceUpdate(root, broken.files, files);
    const pending = files.filter((file) => repair.entries.some((entry) => entry.path === file.path && entry.action !== "unchanged"));
    expect(pending.map((file) => file.path)).toEqual(["Wuthering Waves.exe"]);
    await installResourceManifest(root, pending, official, {
      fetcher: async () => new Response("new"),
    });
    expect(await readFile(executable, "utf8")).toBe("new");
    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe("preserve");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installs resources and metadata together, preserving launcher fields and converging the next plan", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-installation-"));
  try {
    await writeFile(join(root, "Game.exe"), "fixture");
    await writeFile(join(root, "launcherDownloadConfig.json"), JSON.stringify({ version: "1.0", appId: "keep" }));
    await installResourceManifest(root, manifest.files, manifest, {
      fetcher: async () => new Response("new"),
    });
    const local = await inspectLocalInstallation(join(root, "Game.exe"));
    expect(local.version).toBe("2.0");
    expect(planResourceUpdate(local.files, manifest.files).totalBytes).toBe(0);
    await rm(join(root, "a.dat"));
    expect((await planInstalledResourceUpdate(root, local.files, manifest.files)).downloadCount).toBe(1);
    expect(JSON.parse(await readFile(join(root, "launcherDownloadConfig.json"), "utf8"))).toEqual({
      version: "2.0",
      appId: "keep",
      state: "download_completed",
      isPreDownload: false,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cancellation before replacement preserves old version, manifest and resource", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-installation-cancel-"));
  const controller = new AbortController();
  try {
    await writeFile(join(root, "a.dat"), "old");
    await writeFile(join(root, "LocalGameResources.json"), "old-manifest");
    await writeFile(join(root, "launcherDownloadConfig.json"), '{"version":"1.0"}');
    await expect(
      installResourceManifest(root, manifest.files, manifest, {
        signal: controller.signal,
        fetcher: async () => new Response("new"),
        onProgress: ({ completedFiles, totalFiles }) => {
          if (completedFiles === totalFiles) controller.abort(new Error("cancelled"));
        },
      }),
    ).rejects.toThrow("cancelled");
    expect(await readFile(join(root, "a.dat"), "utf8")).toBe("old");
    expect(await readFile(join(root, "LocalGameResources.json"), "utf8")).toBe("old-manifest");
    expect(await readFile(join(root, "launcherDownloadConfig.json"), "utf8")).toBe('{"version":"1.0"}');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects skipped resources missing from disk before advancing the version", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-installation-missing-"));
  try {
    await expect(installResourceManifest(root, [], manifest)).rejects.toThrow("本地资源已变化");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an incremental update keeps the partial legacy record and does not require files outside the patch", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-incremental-record-"));
  const resource = (path: string, body: string) => ({
    path,
    size: body.length,
    md5: createHash("md5").update(body).digest("hex"),
    url: `https://example.invalid/${path}`,
  });
  const changed = resource("changed.dat", "new"),
    existing = resource("existing.dat", "keep"),
    unrecorded = resource("optional-sdk.dat", "optional");
  const official = {
    ...manifest,
    files: [changed, existing, unrecorded],
    totalBytes: 15,
    patch: {
      fromVersion: "1.0",
      files: [changed],
      groups: [],
      deleteFiles: ["obsolete.dat"],
    },
  };
  try {
    await writeFile(join(root, "launcherDownloadConfig.json"), JSON.stringify({ version: "1.0", appId: "keep" }));
    await writeFile(
      join(root, "LocalGameResources.json"),
      JSON.stringify({
        resource: [
          { dest: existing.path, size: existing.size, md5: existing.md5 },
          { dest: "obsolete.dat", size: 3, md5: "a".repeat(32) },
        ],
      }),
    );
    await writeFile(join(root, existing.path), "keep");
    await writeFile(join(root, "obsolete.dat"), "old");
    const requests: string[] = [];
    await installResourceManifest(root, [changed], official, {
      fetcher: async (input) => {
        requests.push(String(input));
        return new Response("new");
      },
    });
    expect(requests).toEqual([changed.url]);
    expect(await readFile(join(root, existing.path), "utf8")).toBe("keep");
    expect(await Bun.file(join(root, unrecorded.path)).exists()).toBe(false);
    const record = JSON.parse(await readFile(join(root, "LocalGameResources.json"), "utf8"));
    expect(record.resource.map((file: { dest: string }) => file.dest).sort()).toEqual([changed.path, existing.path].sort());
    expect(JSON.parse(await readFile(join(root, "launcherDownloadConfig.json"), "utf8")).version).toBe("2.0");
    expect(await Bun.file(join(root, "obsolete.dat")).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
