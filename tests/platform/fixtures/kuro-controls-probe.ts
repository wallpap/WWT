import { fileURLToPath } from "node:url";
import { buildBrowser } from "../../../scripts/browser-build.ts";
import { NativeWebview } from "../../../src/platform/native-webview.ts";
import type { SignTarget } from "../../../src/kujiequ/sign.ts";

const html = await Bun.file(new URL("../../../src/index.html", import.meta.url)).text();
const css = await Bun.file(new URL("../../../src/style.css", import.meta.url)).text();
const build = await buildBrowser({
  entrypoints: [fileURLToPath(new URL("./kuro-controls-entry.ts", import.meta.url))],
  format: "iife",
});
const script = await build.outputs[0]!.text();
const view = new NativeWebview("WWT Kuro controls (offline, auto closes)", 1000, 700);
let result: unknown = null;
let selected = "10001";
let writes = 0;
let batchWrites = 0;
let tokenLogin = false;
const roles = ["10001", "10002"].map((roleId) => ({
  roleId,
  roleName: `测试${roleId}`,
  userId: "fixture",
  serverId: "cn",
  serverName: "国服",
}));
const accounts = () => ({
  accounts: [{ id: "fixture", label: "测试账号", roles }],
  selectedAccountId: "fixture",
  selectedRoleId: selected,
});
const signs = () => ({
  accountId: "fixture",
  roleId: selected,
  serverId: "cn",
  roleName: `测试${selected}`,
  signed: writes > 0,
  signDays: writes,
  rewards: [{ name: "星声", count: "20", received: writes > 0 }],
  history: [],
});
view.bind("loadKuroAccounts", accounts);
view.bind("loginKuroAccount", accounts);
view.bind("loginKuroToken", (token: string, did: string, source: string) => {
  tokenLogin = token === "fixture-token" && did === "fixture-did" && source === "android";
  return accounts();
});
view.bind("selectKuroRole", (_account: string, role: string) => {
  selected = role;
  return accounts();
});
view.bind("loadKuroDaily", async () => {
  const captured = selected;
  await Bun.sleep(captured === "10001" ? 180 : 5);
  return {
    roleId: captured,
    roleName: `测试${captured}`,
    updatedAt: Date.now(),
    metrics: [{ name: "波片", value: captured === "10001" ? "80 / 240" : "160 / 240" }],
    base: [],
    boxes: [],
  };
});
view.bind("loadKuroSign", signs);
view.bind("submitKuroSign", async () => {
  await Bun.sleep(30);
  writes++;
  return { submitted: true, view: signs(), message: "签到成功" };
});
view.bind("previewKuroBatchSign", () =>
  roles.map((role) => ({
    accountId: "fixture",
    roleId: role.roleId,
    serverId: "cn",
    roleName: role.roleName,
  })),
);
view.bind("submitKuroBatchSign", (targets: SignTarget[]) => {
  batchWrites++;
  return targets.map((target) => ({
    target,
    result: { submitted: true, view: null, message: "签到成功" },
    error: null,
  }));
});
view.bind("finish", (values: Record<string, unknown>) => {
  result = { ...values, tokenLogin, writes, batchWrites };
  view.terminate();
});
view.setHtml(
  html.replace('<link rel="stylesheet" href="/style.css" />', `<style>${css}</style>`).replace(
    "</body>",
    `<script>${script}</script><script>
const find = id => document.getElementById(id);
const nav = page => document.querySelector('.nav-item[data-page-target="'+page+'"]').click();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i=0;i<100;i++) { if(check()) return; await pause(20); } throw new Error('UI timeout'); }
setTimeout(async () => { try {
  await until(() => find('kuro-account-notice').textContent.includes('已选择'));
  nav('account');
  find('kuro-token-tab').click();
  find('kuro-token-tab').dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowLeft', bubbles: true}));
  const keyboardTabs = !find('kuro-login-form').hidden && find('kuro-sms-tab').getAttribute('aria-selected') === 'true';
  find('kuro-sms-tab').dispatchEvent(new KeyboardEvent('keydown', {key: 'End', bubbles: true}));
  const loginTabs = find('kuro-login-form').hidden && !find('kuro-token-form').hidden && find('kuro-token-tab').getAttribute('aria-selected') === 'true';
  find('kuro-token').value = 'fixture-token'; find('kuro-did').value = 'fixture-did';
  find('kuro-token-form').dispatchEvent(new Event('submit', {cancelable: true}));
  await until(() => !find('kuro-account-fields').disabled);
  const credentialsCleared = find('kuro-token').value === '' && find('kuro-did').value === '';
  nav('daily');
  await pause(30);
  nav('account');
  find('kuro-role').value = '10002'; find('kuro-role').dispatchEvent(new Event('change'));
  await until(() => !find('kuro-account-fields').disabled);
  nav('daily');
  await until(() => find('kuro-daily-metrics').textContent.includes('160 / 240'));
  await pause(230);
  const staleIgnored = find('kuro-daily-metrics').textContent.includes('160 / 240') && !find('kuro-daily-metrics').textContent.includes('80 / 240');
  nav('sign');
  await until(() => !find('kuro-sign-submit').disabled);
  const noAutoSign = find('kuro-sign-notice').textContent.includes('未签到');
  find('kuro-sign-submit').click(); find('kuro-sign-submit').click();
  await until(() => find('kuro-sign-notice').textContent.includes('签到成功'));
  const signedDisabled = find('kuro-sign-submit').disabled;
  find('kuro-sign-batch-preview').click();
  await until(() => !find('kuro-sign-batch-submit').hidden);
  const previewVisible = find('kuro-sign-batch-notice').textContent.includes('10001') && find('kuro-sign-batch-notice').textContent.includes('10002');
  find('kuro-sign-batch-submit').click();
  await until(() => find('kuro-sign-batch-notice').textContent.includes('签到成功'));
  window.finish({staleIgnored,noAutoSign,signedDisabled,previewVisible,credentialsCleared,loginTabs,keyboardTabs});
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
