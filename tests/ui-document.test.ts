import { expect, test } from "bun:test";
import { Script } from "node:vm";
import { fileURLToPath } from "node:url";
import { buildBrowser } from "../scripts/browser-build.ts";
import { assembleUi } from "../src/ui-document.ts";

test("UI assembly preserves replacement patterns in embedded styles and scripts", () => {
  const html = '<html><head><link rel="stylesheet" href="/style.css" /></head><body></body></html>';
  const patterns = "$` $& $' $$";
  const styles = `.example::after { content: "${patterns}"; }`;
  const renderer = `globalThis.example = ${JSON.stringify(patterns)};`;
  expect(assembleUi(html, styles, renderer)).toBe(`<html><head><style>${styles}</style></head><body><script>${renderer}</script></body></html>`);
});

test("the assembled application contains the intact executable renderer bundle", async () => {
  const build = await buildBrowser({
    entrypoints: [fileURLToPath(new URL("../src/renderer.ts", import.meta.url))],
    format: "iife",
    minify: true,
  });
  expect(build.success).toBe(true);
  const renderer = await build.outputs[0]!.text();
  const html = await Bun.file(new URL("../src/index.html", import.meta.url)).text();
  const styles = await Bun.file(new URL("../src/style.css", import.meta.url)).text();
  const document = assembleUi(html, styles, renderer, "dark");
  expect(document).toContain('<html lang="zh-CN" data-theme="dark">');
  const embedded = document.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  expect(embedded?.length).toBe(renderer.length);
  expect(embedded).toBe(renderer);
  expect(() => new Script(embedded!)).not.toThrow();
});
