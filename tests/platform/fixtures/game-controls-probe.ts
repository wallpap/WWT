import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildBrowser } from "../../../scripts/browser-build.ts";
import { NativeWebview } from "../../../src/platform/native-webview.ts";

const html = await readFile(new URL("../../../src/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../../../src/style.css", import.meta.url), "utf8");
const build = await buildBrowser({
  entrypoints: [fileURLToPath(new URL("../../../src/game/controls.ts", import.meta.url))],
  format: "esm",
});
const script = (await build.outputs[0]!.text()).replace(/export\s*\{[\s\S]*?\};?\s*$/, "");
const view = new NativeWebview("WWT UX regression (auto closes)", Number(process.argv[2] ?? 1180), 820);
let result: unknown = null;
view.bind("finish", (value: unknown) => {
  result = value;
  view.terminate();
});
view.setHtml(
  html.replace('<link rel="stylesheet" href="/style.css" />', `<style>${css}</style>`).replace(
    "</body>",
    `<script>
let launches = 0, confirmations = 0, installs = 0;
const files = [{path:'Client/a.pak',size:1048576,md5:null,url:'https://example.invalid/a'}];
window.loadAppSettings = async () => ({downloadSource:'mainland',downloadParallel:4,downloadBytesPerSecond:0});
window.updateAppSettings = async settings => settings;
window.loadGameSettings = async () => ({executablePath:'C:\\\\Game\\\\Game.exe', resourceTier:'hd'});
window.inspectResources = async () => ({availableTiers:['hd','sd']});
window.saveGameSettings = async () => {};
window.launchGame = async () => { launches++; };
window.inspectLocalInstallation = async () => ({rootDirectory:'C:\\\\Game',version:'1',files:[],totalBytes:0,manifestPath:null});
window.fetchOfficialResources = async () => ({source:'mainland',version:'2',files,totalBytes:1048576});
window.planResourceUpdate = async () => ({entries:[{path:'Client/a.pak',action:'download'}],totalBytes:1048576,downloadCount:1,replaceCount:0});
window.previewResourceUpdate = async () => 1;
window.confirmResourceUpdate = async () => { confirmations++; };
window.installResourceUpdate = async () => { installs++; return {installedFiles:1,installedBytes:1048576}; };
${script}
initializeGameControls();
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
const button = id => document.getElementById(id);
const until = async test => { for(let i=0;i<80;i++) { if(test()) return; await pause(); } throw new Error('Timed out'); };
(async () => {
  try {
    await until(() => button('game-tier').value === 'hd');
    button('launch-game').click();
    await until(() => launches === 1 && !button('launch-game').disabled);
    const launcher = button('launcher');
    const launchRect = button('launch-game').getBoundingClientRect();
    const pathRect = button('game-path').getBoundingClientRect();
    const launcherFits = launchRect.right <= innerWidth && pathRect.width > 80;
    launcher.hidden = true; button('game-time').hidden = true; button('resources').hidden = false;
    const idleProgressHidden = button('resource-progress-area').hidden;
    button('check-updates').click();
    await until(() => !button('install-resource-update').hidden);
    const summary = button('resource-summary').textContent;
    const noPrematureInstall = confirmations === 0 && installs === 0;
    button('install-resource-update').click();
    await until(() => button('resource-notice').textContent.includes('更新完成'));
    window.finish({launches, confirmations, installs, launcherFits, idleProgressHidden, noPrematureInstall, summaryVisible:summary.includes('1.0 MB'), noOverflow:document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth});
  } catch(error) { window.finish({error:String(error)}); }
})();
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
