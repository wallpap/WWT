import { fileURLToPath } from "node:url";
import { buildBrowser } from "../../../scripts/browser-build.ts";
import { NativeWebview } from "../../../src/platform/native-webview.ts";
import { MigrationService, type MigrationKind } from "../../../src/migration/service.ts";
import { readMigrationSource, type MigrationSource } from "../../../src/migration/read.ts";
import { createGachaService } from "../../../src/gacha/service.ts";
import type { GachaRecord } from "../../../src/gacha/model.ts";

const html = await Bun.file(new URL("../../../src/index.html", import.meta.url)).text();
const build = await buildBrowser({
  entrypoints: [fileURLToPath(new URL("./migration-controls-entry.ts", import.meta.url))],
  format: "iife",
});
if (!build.success) throw new Error("迁移页面检查脚本构建失败");
const script = await build.outputs[0]!.text();
const view = new NativeWebview("WWT migration (offline, auto closes)", 1000, 700);
let result: unknown = null;
let records: GachaRecord[] = [];
const store = createGachaService({
  read: async () => records,
  write: async (next) => {
    records = [...next];
  },
});
const service = new MigrationService(readMigrationSource, store.importRecords);
view.bind("pickMigrationSource", () => fileURLToPath(new URL("../../gacha/fixtures/java-gacha-no-uid.xlsx", import.meta.url)));
view.bind("previewMigration", (source: MigrationSource, path: string, player: string) => service.preview(source, path, player));
view.bind("importMigration", (id: string, kind: MigrationKind) => service.import(id, kind));
view.bind("finish", (values: Record<string, unknown>) => {
  result = {
    ...values,
    records: records.length,
    pulls: records.reduce((sum, row) => sum + row.count, 0),
    player: records[0]?.playerId,
  };
  view.terminate();
});
view.setHtml(
  html.replace(
    "</body>",
    `<script>${script}</script><script>
const find = id => document.getElementById(id);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i=0;i<100;i++) { if(check()) return; await pause(20); } throw new Error('UI timeout: '+find('migration-notice').textContent); }
setTimeout(async () => { try {
  let changed = 0; window.addEventListener('gacha-records-changed', () => changed++);
  document.querySelector('.nav-item[data-page-target="migration"]').click();
  find('migration-browse').click();
  await until(() => !find('migration-preview').disabled);
  find('migration-player').value = '200000002'; find('migration-player').dispatchEvent(new Event('input'));
  find('migration-preview').click();
  await until(() => !find('migration-gacha').disabled);
  const previewed = find('migration-summary').textContent.includes('抽卡 2 条 / 3 抽') && find('migration-time').disabled;
  find('migration-gacha').click(); find('migration-gacha').click();
  await until(() => find('migration-notice').textContent.includes('新增或更新 2 条'));
  find('migration-gacha').click();
  await until(() => find('migration-notice').textContent.includes('跳过重复 2 条'));
  find('migration-path').value = 'changed'; find('migration-path').dispatchEvent(new Event('input'));
  const invalidated = find('migration-gacha').disabled && !find('migration-summary').textContent;
  window.finish({previewed, invalidated, changed});
} catch (error) { window.finish({error: String(error)}); } }, 100);
</script></body>`,
  ),
);
const watchdog = setTimeout(() => view.terminate(), 8000);
try {
  await view.run();
} finally {
  clearTimeout(watchdog);
  view.destroy();
}
console.log(JSON.stringify(result));
