import { fileURLToPath } from "node:url";
import { buildBrowser } from "../../../scripts/browser-build.ts";
import { NativeWebview } from "../../../src/platform/native-webview.ts";
import type { GachaRecord } from "../../../src/gacha/model.ts";

const html = await Bun.file(new URL("../../../src/index.html", import.meta.url)).text();
const build = await buildBrowser({
  entrypoints: [fileURLToPath(new URL("./gacha-history-entry.ts", import.meta.url))],
  format: "esm",
});
if (!build.success) throw new Error("保底历史检查脚本构建失败");
const script = await build.outputs[0]!.text();
const records: GachaRecord[] = Array.from({ length: 102 }, (_, index) => ({
  playerId: "1001",
  gachaName: "角色活动唤取",
  cardPoolType: "1",
  resourceId: 1607,
  qualityLevel: index % 2 === 0 ? 3 : 5,
  resourceType: "角色",
  name: `物品${index}`,
  count: 1,
  time: new Date(1_790_000_000_000 + index * 1000).toISOString(),
}));
records.push({
  ...records[0]!,
  count: 3,
  time: new Date(1_790_000_102_000).toISOString(),
});
records.push({ ...records[0]!, playerId: "2002" });
const view = new NativeWebview("WWT gacha history (offline, auto closes)", 1000, 700);
let result: unknown = null;
view.bind("loadGameImage", () => "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=");
view.bind("loadRecords", () => ({ records }));
view.bind("finish", (values: Record<string, unknown>) => {
  result = values;
  view.terminate();
});
view.setHtml(
  html.replace(
    "</body>",
    () => `<script>
window.addEventListener('error', event => window.finish({error:event.message}));
window.addEventListener('unhandledrejection', event => window.finish({error:String(event.reason)}));
</script><script type="module">${script}</script><script>
const find = id => document.getElementById(id);
window.addEventListener('gacha-history-ready', () => { try {
  const initial = find('gacha-history-summary').textContent;
  const cards = find('gacha-pool-cards').children;
  const overview = cards.length === 2 && cards[0].textContent.includes('105') && cards[1].textContent.includes('已记录未出五星');
  cards[0].querySelector('button').click();
  const cardNavigation = !find('gacha-history').hidden && find('gacha-overview').hidden && find('gacha-history-tab').getAttribute('aria-selected') === 'true';
  find('gacha-history-tab').dispatchEvent(new KeyboardEvent('keydown', {key:'End',bubbles:true}));
  const keyboardTabs = !find('gacha-records').hidden && find('gacha-history').hidden && find('gacha-records-tab').getAttribute('aria-selected') === 'true' && find('gacha-records-tab').tabIndex === 0;
  const complete = initial.includes('总抽数 105') && initial.includes('距上次五星 3 抽') && initial.includes('平均 2.0');
  const firstPage = find('gacha-history-body').children.length === 50 && !find('gacha-history-next').disabled;
  find('gacha-history-next').click();
  const secondPage = find('gacha-history-body').children.length === 1 && find('gacha-history-body').textContent.includes('记录起点至首个五星') && find('gacha-history-next').disabled;
  find('gacha-history-pool').selectedIndex = 1; find('gacha-history-pool').dispatchEvent(new Event('change'));
  const isolated = find('gacha-history-summary').textContent.includes('未出五星 1 抽') && !find('gacha-history-body').children.length;
  window.finish({complete, firstPage, secondPage, isolated, overview, cardNavigation, keyboardTabs});
} catch(error) { window.finish({error:String(error)}); } }, {once:true});
</script></body>`,
  ),
);
const watchdog = setTimeout(() => view.terminate(), 20_000);
try {
  await view.run();
} finally {
  clearTimeout(watchdog);
  view.destroy();
}
console.log(JSON.stringify(result));
