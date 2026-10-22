import { access, cp, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { verifyHpatchz } from "../src/game/hpatchz.ts";
import { compareAppVersions } from "../src/app/update-release.ts";

const projectDirectory = resolve(import.meta.dir, "..");
const distDirectory = resolve(projectDirectory, process.env["WWT_BUILD_DIRECTORY"] ?? "dist");
const sourceNativeLibraryPath = join(projectDirectory, "node_modules/webview-bun/build/libwebview.dll");
const vcRuntimeFiles = {
  "msvcp140.dll": "0f885b509a685d2bbfa652fed26b5fb31d88fbdab0a978c641d1c7b8aa460aa9",
  "vcruntime140.dll": "d5e4d9a3e835fa679450145d6a7d94e36573a509317111904d9b3712c30d9066",
  "vcruntime140_1.dll": "1f2d41c4aa5db0bc33ebf7b66d72943a817d7ce6cbe880502a9403823633093f",
};
const packageMetadata: unknown = JSON.parse(await Bun.file(join(projectDirectory, "package.json")).text());
if (typeof packageMetadata !== "object" || packageMetadata === null) {
  throw new Error("package.json 格式无效");
}
const packageVersion = (packageMetadata as Record<string, unknown>)["version"];
if (typeof packageVersion !== "string") throw new Error("package.json 缺少版本号");
compareAppVersions(packageVersion, packageVersion);

const releaseName = `WWT-${packageVersion}-windows-x64`;
const releaseDirectory = join(distDirectory, releaseName);
const archivePath = join(distDirectory, `${releaseName}.zip`);

for (const command of [
  ["run", "check"],
  ["test", "tests"],
]) {
  const validation = Bun.spawn([process.execPath, ...command], {
    cwd: projectDirectory,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await validation.exited) !== 0) {
    throw new Error(`发布前检查失败：bun ${command.join(" ")}`);
  }
}

await mkdir(distDirectory, { recursive: true });
try {
  await access(join(releaseDirectory, "data"));
  throw new Error(`发布目录包含应用数据，请先备份或移动该目录：${releaseDirectory}`);
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}
await rm(releaseDirectory, { recursive: true, force: true });
await rm(archivePath, { force: true });
const stagingDirectory = await mkdtemp(join(distDirectory, ".wwt-build-"));

try {
  const executablePath = join(stagingDirectory, "WWT.exe");
  const nativeLibraryPath = join(stagingDirectory, "libwebview.dll");
  const licenseDirectory = join(stagingDirectory, "THIRD-PARTY-NOTICES");
  const compile = Bun.spawn([process.execPath, "build", "--compile", "--minify", "--target=bun-windows-x64", "--windows-hide-console", "--windows-title=鸣潮助手", "--windows-icon=src/assets/carlotta.ico", "src/client.ts", `--outfile=${executablePath}`], {
    cwd: projectDirectory,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await compile.exited) !== 0) throw new Error("Windows 便携版构建失败");

  await cp(sourceNativeLibraryPath, nativeLibraryPath);
  for (const [name, sha256] of Object.entries(vcRuntimeFiles)) {
    const source = join(projectDirectory, "vendor/vc-runtime", name);
    const data = await Bun.file(source).arrayBuffer();
    if (createHash("sha256").update(new Uint8Array(data)).digest("hex") !== sha256) throw new Error(`VC++ 运行库校验失败：${name}`);
    await cp(source, join(stagingDirectory, name));
  }
  await cp(join(projectDirectory, "src/assets/carlotta.png"), join(stagingDirectory, "carlotta.png"));
  await verifyHpatchz();
  await cp(join(projectDirectory, "vendor/hdiffpatch/hpatchz.exe"), join(stagingDirectory, "hpatchz.exe"));
  await cp(join(projectDirectory, "LICENSE"), join(stagingDirectory, "LICENSE"));
  await cp(join(projectDirectory, "README.md"), join(stagingDirectory, "README.md"));
  await cp(join(projectDirectory, "ACKNOWLEDGMENTS.md"), join(stagingDirectory, "ACKNOWLEDGMENTS.md"));
  await cp(join(projectDirectory, "docs"), join(stagingDirectory, "docs"), { recursive: true });
  await mkdir(licenseDirectory, { recursive: true });
  await cp(join(projectDirectory, "vendor/vc-runtime"), join(licenseDirectory, "vc-runtime"), { recursive: true, filter: (source) => !source.endsWith(".dll") });
  await cp(join(projectDirectory, "vendor/hdiffpatch"), join(licenseDirectory, "hdiffpatch"), { recursive: true, filter: (source) => !source.endsWith(".exe") });
  await cp(join(projectDirectory, "node_modules/webview-bun/LICENSE"), join(licenseDirectory, "webview-bun-LICENSE"));
  await writeFile(join(stagingDirectory, "README.txt"), ["鸣潮助手 Windows 便携版", "", "直接运行 WWT.exe。应用数据会保存在同目录的 data 文件夹中。", "包内已附带所需的 Microsoft Visual C++ x64 运行库，请保留所有 DLL 文件。", "启动时会检查 Microsoft Edge WebView2 Runtime，缺失时可按提示打开微软官方下载页。安装后重新启动助手。", "", "完整说明见 README.md 和 docs 文件夹，原项目说明与致谢见 ACKNOWLEDGMENTS.md。", "第三方许可证位于 THIRD-PARTY-NOTICES 文件夹。", ""].join("\r\n"), "utf8");

  await Promise.all([access(executablePath), access(nativeLibraryPath)]);
  await rename(stagingDirectory, releaseDirectory);
  const escapePowerShellString = (value: string): string => value.replaceAll("'", "''");
  const archive = Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${escapePowerShellString(releaseDirectory)}', '${escapePowerShellString(archivePath)}', [System.IO.Compression.CompressionLevel]::Optimal, $true)`], {
    cwd: projectDirectory,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await archive.exited) !== 0) {
    throw new Error(`便携目录已生成，但 ZIP 压缩失败：${releaseDirectory}`);
  }
  await access(archivePath);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archivePath)) hash.update(chunk);
  const sha256 = hash.digest("hex");
  const archiveName = `${releaseName}.zip`;
  const checksumPath = `${archivePath}.sha256`;
  const manifestPath = join(distDirectory, "update.json");
  await writeFile(checksumPath, `${sha256}  ${archiveName}\n`, "utf8");
  await writeFile(manifestPath, `${JSON.stringify({ app: "wwt-bun", version: packageVersion, publishedAt: new Date().toISOString(), notes: "", asset: { name: archiveName, url: archiveName, size: Bun.file(archivePath).size, sha256 } }, null, 2)}\n`, "utf8");
  console.log(`Portable build: ${releaseDirectory}`);
  console.log(`Release archive: ${archivePath}`);
  console.log(`Update manifest: ${manifestPath}`);
  console.log(`SHA-256: ${checksumPath}`);
} finally {
  await rm(stagingDirectory, { recursive: true, force: true });
}
