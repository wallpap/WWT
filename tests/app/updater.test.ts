import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compareAppVersions, fetchAppRelease, normalizeUpdateSource, parseAppRelease } from "../../src/app/update-release.ts";
import { AppUpdateService } from "../../src/app/updater.ts";
import { extractAppUpdate, startAppUpdateWorker } from "../../src/platform/app-update.ts";

const folder = "WWT-0.2.0-windows-x64";
const portableFixtureFiles = ["WWT.exe", "libwebview.dll", "hpatchz.exe", "carlotta.png", "msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll", "LICENSE", "README.txt", "README.md", "ACKNOWLEDGMENTS.md", "docs/usage.md", "THIRD-PARTY-NOTICES/notice.txt"];
async function zipFixture(root: string, extra = "", omitted = ""): Promise<Buffer> {
  const archive = join(root, `${crypto.randomUUID()}.zip`);
  const entries = portableFixtureFiles.filter((path) => path !== omitted).map((path) => `${folder}/${path}`);
  if (extra) entries.push(`${folder}/${extra}`);
  const plan = join(root, "zip-entries.json");
  await writeFile(plan, JSON.stringify(entries));
  const script = `Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$zip = [IO.Compression.ZipArchive]::new([IO.File]::Create($env:WWT_TEST_ZIP), [IO.Compression.ZipArchiveMode]::Create)
try { foreach($name in ([IO.File]::ReadAllText($env:WWT_TEST_ENTRIES) | ConvertFrom-Json)) { $entry=$zip.CreateEntry($name); $stream=$entry.Open(); try { $bytes=[Text.Encoding]::UTF8.GetBytes('fixture'); $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() } } } finally { $zip.Dispose() }`;
  const child = Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    env: { ...process.env, WWT_TEST_ZIP: archive, WWT_TEST_ENTRIES: plan },
    stdout: "ignore",
    stderr: "ignore",
    windowsHide: true,
  });
  if (await child.exited) throw new Error("测试 ZIP 创建失败");
  return readFile(archive);
}
const manifest = (body: Buffer) => ({
  app: "wwt-bun",
  version: "0.2.0",
  notes: "更新说明",
  asset: {
    name: `${folder}.zip`,
    url: `${folder}.zip`,
    size: body.length,
    sha256: createHash("sha256").update(body).digest("hex"),
  },
});

test("update releases compare semantic versions and require the Bun package identity and SHA-256", async () => {
  expect(compareAppVersions("0.10.0", "0.2.0")).toBe(1);
  expect(compareAppVersions("1.0.0", "1.0.0-rc.9")).toBe(1);
  expect(compareAppVersions("1.0.0-beta.10", "1.0.0-beta.2")).toBe(1);
  expect(compareAppVersions("1.0.0+build.1", "1.0.0+build.2")).toBe(0);
  expect(() => compareAppVersions("1.0.0+build..1", "1.0.0")).toThrow("版本号");
  expect(normalizeUpdateSource("https://github.com/owner/project.git")).toBe("owner/project");
  expect(() => normalizeUpdateSource("https://user:secret@example.invalid/feed.json")).toThrow("凭据");
  expect(() => parseAppRelease({ ...manifest(Buffer.from("test")), app: "original-java" }, "https://example.invalid/feed.json")).toThrow("不匹配");
  const asset = manifest(Buffer.from("test")).asset;
  const release = await fetchAppRelease("owner/project", async () =>
    Response.json({
      tag_name: "v0.2.0",
      body: "notes",
      assets: [
        {
          ...asset,
          browser_download_url: `https://example.invalid/${asset.name}`,
          digest: `sha256:${asset.sha256}`,
        },
      ],
    }),
  );
  expect(release.version).toBe("0.2.0");
  expect(release.asset.sha256).toBe(asset.sha256);
});

test("portable extraction rejects traversal and data replacement before touching the installation", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-app-extract-"));
  try {
    for (const [index, extra] of ["", "../escape.txt", "data/account.bin"].entries()) {
      const archive = join(root, `package-${index}.zip`);
      await writeFile(archive, await zipFixture(root, extra));
      const workspace = join(root, `stage-${index}`);
      if (extra) await expect(extractAppUpdate(archive, workspace, folder)).rejects.toThrow("解压或检查失败");
      else {
        const files = await extractAppUpdate(archive, workspace, folder);
        expect(files.map((file) => file.path)).toContain("WWT.exe");
        expect(files.map((file) => file.path)).toContain("msvcp140.dll");
        expect(files.map((file) => file.path)).toContain("docs/usage.md");
        expect(await readFile(join(workspace, "package/WWT.exe"), "utf8")).toBe("fixture");
      }
    }
    expect(await Bun.file(join(root, "escape.txt")).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);

test("app update staging verifies the complete archive, leaves data intact and consumes a specific prepared offer", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-app-updater-"));
  try {
    const body = await zipFixture(root),
      release = manifest(body);
    const dataDirectory = join(root, "data");
    await mkdir(dataDirectory);
    await writeFile(join(dataDirectory, "account.bin"), "preserve");
    await writeFile(join(root, "WWT.exe"), "old executable");
    let workers = 0;
    const service = new AppUpdateService({
      root,
      dataDirectory,
      currentVersion: "0.1.0",
      portable: true,
      fetcher: async (input) => (String(input).endsWith(".zip") ? new Response(new Uint8Array(body)) : Response.json(release)),
      worker: async (path) => {
        workers++;
        const plan = JSON.parse(await readFile(path, "utf8"));
        expect(plan.files.map((file: { path: string }) => file.path)).toEqual(portableFixtureFiles);
      },
    });
    const offer = await service.check("https://example.invalid/feed.json");
    expect(offer.available).toBe(true);
    await expect(service.install(offer.id)).rejects.toThrow("先下载");
    const ready = await service.prepare(offer.id);
    expect(ready.fileCount).toBe(portableFixtureFiles.length);
    expect(await readFile(join(root, "WWT.exe"), "utf8")).toBe("old executable");
    expect(await readFile(join(dataDirectory, "account.bin"), "utf8")).toBe("preserve");
    await writeFile(join(ready.directory, "ready"), "stale");
    await expect(startAppUpdateWorker(join(ready.directory, "plan.json"))).rejects.toThrow("安装器未能准备完成");
    expect(await Bun.file(join(ready.directory, "ready")).exists()).toBe(false);
    expect(await readFile(join(root, "WWT.exe"), "utf8")).toBe("old executable");
    await expect(service.install("wrong-offer")).rejects.toThrow("先下载");
    await service.install(offer.id);
    expect(workers).toBe(1);
    await expect(service.install(offer.id)).rejects.toThrow("正在处理");
    const broken = new AppUpdateService({
      root,
      dataDirectory,
      portable: true,
      fetcher: async (input) =>
        String(input).endsWith(".zip")
          ? new Response(new Uint8Array(body))
          : Response.json({
              ...release,
              asset: { ...release.asset, sha256: "0".repeat(64) },
            }),
    });
    const invalid = await broken.check("https://example.invalid/feed.json");
    await expect(broken.prepare(invalid.id)).rejects.toThrow("SHA-256");
    expect(broken.busy).toBe(false);
    expect((await readdir(root)).filter((name) => name.startsWith(".wwt-app-update-"))).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);

test("portable extraction rejects a package missing the app-local C++ runtime before extracting files", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-app-runtime-"));
  try {
    const archive = join(root, "incomplete.zip");
    const workspace = join(root, "stage");
    await writeFile(archive, await zipFixture(root, "", "vcruntime140_1.dll"));
    await expect(extractAppUpdate(archive, workspace, folder)).rejects.toThrow("解压或检查失败");
    expect(await Bun.file(join(workspace, "package/WWT.exe")).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 10_000);

test("rechecking invalidates an earlier prepared update and cancellation releases staging", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-app-cancel-"));
  try {
    const body = Buffer.from("fixture"),
      release = manifest(body);
    let waitForCancel = false;
    let extracting!: () => void;
    const entered = new Promise<void>((resolve) => {
      extracting = resolve;
    });
    const service = new AppUpdateService({
      root,
      portable: true,
      dataDirectory: join(root, "data"),
      fetcher: async (input) => (String(input).endsWith(".zip") ? new Response(new Uint8Array(body)) : Response.json(release)),
      extract: async (_archive, _workspace, _folder, signal) => {
        if (waitForCancel) {
          extracting();
          await new Promise<void>((_resolve, reject) => {
            signal!.addEventListener("abort", () => reject(signal!.reason), {
              once: true,
            });
          });
        }
        return [{ path: "WWT.exe", sha256: release.asset.sha256 }];
      },
      worker: async () => {
        throw new Error("should not install");
      },
    });
    const first = await service.check("https://example.invalid/feed.json");
    await service.prepare(first.id);
    const second = await service.check("https://example.invalid/second.json");
    await expect(service.install(first.id)).rejects.toThrow("先下载");
    waitForCancel = true;
    const outcome = service.prepare(second.id).then(
      () => null,
      (error: unknown) => error,
    );
    await entered;
    service.cancel();
    expect(String(await outcome)).toContain("取消");
    expect(service.busy).toBe(false);
    await expect(service.install(second.id)).rejects.toThrow("先下载");
    expect((await readdir(root)).filter((name) => name.startsWith(".wwt-app-update-"))).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the last update result is chosen by modification time rather than random workspace name", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-app-result-"));
  try {
    for (const [name, message, time] of [
      ["z-old", "old", 1],
      ["a-new", "new", 2],
    ] as const) {
      const directory = join(root, `.wwt-app-update-${name}`);
      await mkdir(directory);
      const path = join(directory, "result.json");
      await writeFile(path, JSON.stringify({ status: "installed", message }));
      await utimes(path, time, time);
    }
    expect(await new AppUpdateService({ root }).lastResult()).toEqual({
      status: "installed",
      message: "new",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("portable file installation keeps data and rolls back earlier replacements when a DLL is locked", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-app-transaction-"));
  try {
    const script = `. ([ScriptBlock]::Create([IO.File]::ReadAllText($env:WWT_TEST_HELPER)))
$plan = [IO.File]::ReadAllText($env:WWT_TEST_PLAN) | ConvertFrom-Json
$workspace = [IO.Path]::GetDirectoryName($env:WWT_TEST_PLAN)
$lock = $null
if ($env:WWT_TEST_LOCK -eq '1') { $lock = [IO.File]::Open((Join-Path $plan.root 'libwebview.dll'), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read) }
try { Install-AppPackage $plan $workspace } finally { if ($lock) { $lock.Dispose() } }`;
    for (const locked of [false, true]) {
      const installation = join(root, locked ? "failure" : "success"),
        workspace = join(installation, ".wwt-app-update-test"),
        staging = join(workspace, "package");
      await mkdir(staging, { recursive: true });
      await mkdir(join(installation, "data"));
      await writeFile(join(installation, "data/account.bin"), "preserve");
      const paths = ["LICENSE", "README.txt", "msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll", "libwebview.dll", "hpatchz.exe", "carlotta.png", "WWT.exe"];
      for (const path of paths) {
        await writeFile(join(installation, path), `old ${path}`);
        await writeFile(join(staging, path), `new ${path}`);
      }
      const plan = {
        root: installation,
        files: paths.map((path) => ({
          path,
          sha256: createHash("sha256").update(`new ${path}`).digest("hex"),
        })),
      };
      const planPath = join(workspace, "plan.json");
      await writeFile(planPath, JSON.stringify(plan));
      const child = Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
        env: {
          ...process.env,
          WWT_TEST_HELPER: join(import.meta.dir, "../../src/platform/app-update-helper.ps1"),
          WWT_TEST_PLAN: planPath,
          WWT_TEST_LOCK: locked ? "1" : "0",
        },
        stdout: "ignore",
        stderr: "pipe",
        windowsHide: true,
      });
      const diagnostics = new Response(child.stderr).text();
      const code = await child.exited;
      if (!locked && code !== 0) throw new Error(await diagnostics);
      await diagnostics;
      expect(code === 0).toBe(!locked);
      for (const path of paths) expect(await readFile(join(installation, path), "utf8")).toBe(`${locked ? "old" : "new"} ${path}`);
      expect(await readFile(join(installation, "data/account.bin"), "utf8")).toBe("preserve");
      const journal = JSON.parse(await readFile(join(workspace, "journal.json"), "utf8"));
      expect(journal.phase).toBe(locked ? "rolled-back" : "committed");
      if (!locked) expect(await readFile(join(workspace, "backup/WWT.exe"), "utf8")).toBe("old WWT.exe");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
