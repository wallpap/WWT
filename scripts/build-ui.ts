import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { buildBrowser } from "./browser-build.ts";

const projectDirectory = resolve(import.meta.dir, "..");
const outputDirectory = join(projectDirectory, ".build");
const outputFile = join(outputDirectory, "renderer.js");

await mkdir(dirname(outputFile), { recursive: true });

const result = await buildBrowser({
  entrypoints: [join(projectDirectory, "src/renderer.ts")],
  format: "iife",
  minify: true,
  naming: "renderer.js",
  outdir: outputDirectory,
});

if (!result.success) {
  throw new AggregateError(result.logs, "客户端界面构建失败");
}

console.log(`UI bundle: ${outputFile}`);
