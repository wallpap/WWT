import { readFile } from "node:fs/promises";
import { NativeWebview } from "../../../src/platform/native-webview.ts";

const html = await readFile(new URL("../../../src/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../../../src/style.css", import.meta.url), "utf8");
const navigation = new Bun.Transpiler({ loader: "ts" }).transformSync(await readFile(new URL("../../../src/navigation.ts", import.meta.url), "utf8")).replace("export ", "");
const quickNavigation = new Bun.Transpiler({ loader: "ts" }).transformSync(await readFile(new URL("../../../src/quick-navigation.ts", import.meta.url), "utf8")).replace("export ", "");
const view = new NativeWebview("WWT navigation regression (auto closes)", 1000, 600);
let result: unknown = null;
view.bind("finish", (value: unknown) => {
  result = value;
  view.terminate();
});
view.setHtml(
  html.replace('<link rel="stylesheet" href="/style.css" />', `<style>${css}</style>`).replace(
    "</body>",
    `<script>
${navigation}
${quickNavigation}
initializeNavigation();
initializeQuickNavigation();
setTimeout(async () => {
  try {
    const main = document.querySelector('main');
    const sidebar = document.querySelector('.sidebar');
    const nav = page => document.querySelector('.nav-item[data-page-target="' + page + '"]');
    const pause = () => new Promise(resolve => setTimeout(resolve, 50));
    nav('gacha').click();
    document.querySelector('#records-body').innerHTML = '<tr><td>fixture</td></tr>'.repeat(200);
    main.scrollTop = 500;
    await pause();
    const scrolled = main.scrollTop > 0;
    const sidebarFixed = sidebar.getBoundingClientRect().top === 0 && document.scrollingElement.scrollTop === 0;
    nav('resources').click();
    await pause();
    const pageChanged = !document.querySelector('#resources').hidden && document.querySelector('#gacha').hidden;
    const reset = main.scrollTop === 0;
    const active = nav('resources').getAttribute('aria-current') === 'page' && !nav('gacha').classList.contains('active');
    document.querySelector('.brand').click();
    await pause();
    const home = !document.querySelector('#launcher').hidden && !document.querySelector('#game-time').hidden && document.querySelector('#resources').hidden;
    const dialog = document.querySelector('#quick-nav-dialog');
    const input = document.querySelector('#quick-nav-input');
    document.querySelector('#quick-nav-open').click();
    const quickOpened = dialog.open && document.activeElement === input;
    input.value = '抽卡'; input.dispatchEvent(new Event('input'));
    const quickFiltered = document.querySelectorAll('#quick-nav-results [role="option"]').length === 1;
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true}));
    const quickNavigated = !dialog.open && !document.querySelector('#gacha').hidden && document.activeElement.id === 'page-label';
    const focusBeforeQuick = document.activeElement;
    document.querySelector('#quick-nav-open').click();
    input.value = '不存在的功能'; input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true}));
    const quickEmpty = dialog.open && !document.querySelector('#quick-nav-empty').hidden && !input.hasAttribute('aria-activedescendant');
    input.value = ''; input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowUp', bubbles: true, cancelable: true}));
    const lastOption = document.querySelector('#quick-nav-results').lastElementChild;
    const quickWraps = lastOption.getAttribute('aria-selected') === 'true' && input.getAttribute('aria-activedescendant') === lastOption.id;
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
    const quickClosed = !dialog.open && document.activeElement === focusBeforeQuick;
    window.finish({scrolled, sidebarFixed, pageChanged, reset, active, home, noHash: location.hash === '', quickOpened, quickFiltered, quickNavigated, quickEmpty, quickWraps, quickClosed});
  } catch (error) { window.finish({error: String(error)}); }
}, 100);
</script></body>`,
  ),
);
const watchdog = setTimeout(() => view.terminate(), 5000);
try {
  await view.run();
} finally {
  clearTimeout(watchdog);
  view.destroy();
}
console.log(JSON.stringify(result));
