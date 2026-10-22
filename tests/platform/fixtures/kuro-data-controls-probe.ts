import { fileURLToPath } from "node:url";
import { buildBrowser } from "../../../scripts/browser-build.ts";
import { NativeWebview } from "../../../src/platform/native-webview.ts";
import { parseOwnedRoles, parseRoleDetail } from "../../../src/kujiequ/role.ts";
import { parseTower, parseSlash, parseNewTower } from "../../../src/kujiequ/challenge.ts";
import { parseCalculatorResult, type RoleAim } from "../../../src/kujiequ/calculator.ts";

const html = await Bun.file(new URL("../../../src/index.html", import.meta.url)).text();
const css = await Bun.file(new URL("../../../src/style.css", import.meta.url)).text();
const build = await buildBrowser({
  entrypoints: [fileURLToPath(new URL("./kuro-data-controls-entry.ts", import.meta.url))],
  format: "iife",
});
if (!build.success) throw new Error("数据页面检查脚本构建失败");
const script = await build.outputs[0]!.text();
const view = new NativeWebview("WWT data controls (offline, auto closes)", 1000, 700);
const owned = parseOwnedRoles({
  roleList: [{ roleId: "101", roleName: "漂泊者", level: 80 }],
});
const detail = parseRoleDetail(
  {
    role: { roleId: "101", roleName: "漂泊者" },
    level: 80,
    weaponData: { level: 90, weapon: { weaponName: "测试武器" } },
  },
  owned[0]!,
);
let result: unknown = null;
let forcedBriefings = 0;
let challengeFails = false;
let calculatorAim: RoleAim | null = null;
view.bind("loadKuroRoleData", () => ({
  roleId: "10001",
  roleName: "测试账号",
  updatedAt: Date.now(),
  roles: owned,
  detail,
}));
view.bind("loadLocalKuroRoleData", () => ({
  roleId: "10001",
  roleName: "测试账号",
  updatedAt: Date.now(),
  roles: owned,
  detail,
}));
view.bind("loadKuroRoleDetail", () => detail);
view.bind("loadKuroBriefingPeriods", () => ({
  weeks: [
    { title: "第一周", index: "1" },
    { title: "第二周", index: "2" },
  ],
  months: [],
  versions: [],
}));
view.bind("loadKuroBriefingDetail", (_kind: string, index: string, force: boolean) => {
  if (force) forcedBriefings++;
  return {
    kind: "week",
    period: { title: index === "2" ? "第二周" : "第一周", index },
    updatedAt: Date.now(),
    record: {
      totalStar: 20,
      totalCoin: 100,
      starItems: [],
      coinItems: [],
      description: "",
    },
  };
});
view.bind("failChallengeReload", () => {
  challengeFails = true;
});
view.bind("loadKuroChallenges", () => {
  if (challengeFails) throw new Error("测试角色查询失败");
  return {
    roleId: "10001",
    roleName: "测试账号",
    updatedAt: Date.now(),
    tower: parseTower({
      isUnlock: true,
      difficultyList: [
        {
          towerAreaList: [
            {
              areaName: "测试区域",
              star: 3,
              maxStar: 12,
              floorList: [{ floor: 1, star: 3 }],
            },
          ],
        },
      ],
    }),
    slash: parseSlash({}),
    newTower: parseNewTower({}),
  };
});
view.bind("loadKuroChallengeHistory", () => []);
view.bind("loadKuroCalculatorTargets", () => []);
view.bind("loadKuroCalculator", () => ({
  roleName: "测试账号",
  updatedAt: Date.now(),
  roles: [{ id: "101", name: "漂泊者", starLevel: 5 }],
  weapons: [{ id: "201", name: "测试武器", starLevel: 5 }],
}));
view.bind("calculateKuroRole", (aim: RoleAim) => {
  calculatorAim = aim;
  return parseCalculatorResult({
    roleNum: 1,
    preview: { allCost: [{ name: "贝币", num: 100 }] },
  });
});
view.bind("finish", (values: Record<string, unknown>) => {
  const calculatorTargets = calculatorAim?.roleId === "101" && calculatorAim.skillLevelUpList[0]?.startLevel === 3 && calculatorAim.skillLevelUpList[0]?.endLevel === 6 && calculatorAim.skillLevelUpList.slice(1).every((skill) => skill.startLevel === 1 && skill.endLevel === 1) && JSON.stringify(calculatorAim.advanceSkillList) === JSON.stringify(["2-3", "3-5"]);
  result = { ...values, forcedBriefings, calculatorTargets };
  view.terminate();
});
view.setHtml(
  html.replace('<link rel="stylesheet" href="/style.css" />', () => `<style>${css}</style>`).replace(
    "</body>",
    () => `<script>${script}</script><script>
const find = id => document.getElementById(id);
const nav = page => document.querySelector('.nav-item[data-page-target="'+page+'"]').click();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i=0;i<100;i++) { if(check()) return; await pause(20); } throw new Error('UI timeout: '+find('kuro-role-notice').textContent); }
setTimeout(async () => { try {
  nav('role');
  await until(() => !find('kuro-role-refresh').disabled);
  const roleLoaded = find('kuro-role-notice').textContent.includes('1 个已拥有角色') && find('kuro-role-weapon').textContent.includes('测试武器');
  window.dispatchEvent(new Event('kuro-account-changed'));
  await until(() => !find('kuro-role-refresh').disabled);
  const roleReloaded = find('kuro-role-weapon').textContent.includes('测试武器');
  nav('briefing');
  await until(() => find('kuro-briefing-metrics').textContent.includes('第二周') && !find('kuro-briefing-period').disabled);
  find('kuro-briefing-period').value = '1'; find('kuro-briefing-period').dispatchEvent(new Event('change'));
  await until(() => !find('kuro-briefing-period').disabled);
  const briefingSelection = find('kuro-briefing-period').value === '1' && find('kuro-briefing-metrics').textContent.includes('第一周');
  find('kuro-briefing-refresh').click();
  await pause(20);
  await until(() => !find('kuro-briefing-refresh').disabled);
  const briefingRefresh = find('kuro-briefing-period').value === '1' && find('kuro-briefing-metrics').textContent.includes('第一周');
  find('kuro-briefing-kind').value = 'month'; find('kuro-briefing-kind').dispatchEvent(new Event('change'));
  await pause(20);
  const briefingEmpty = find('kuro-briefing-period').disabled && !find('kuro-briefing-metrics').textContent;
  nav('challenge');
  await until(() => find('kuro-tower-body').textContent.includes('测试区域'));
  const challengeTitles = find('kuro-slash-period').parentElement.previousElementSibling.textContent === '冥歌海墟' && find('kuro-new-tower-period').parentElement.previousElementSibling.textContent === '终焉矩阵';
  const floorStars = find('kuro-tower-body').querySelector('tr').children[2].textContent === '3';
  await window.failChallengeReload();
  window.dispatchEvent(new Event('kuro-account-changed'));
  const challengeCleared = !find('kuro-tower-body').textContent && !find('kuro-tower-metrics').textContent;
  await until(() => !find('kuro-challenge-refresh').disabled);
  nav('calculator');
  await until(() => find('kuro-calculator-role').value === '101' && !find('kuro-calculator-refresh').disabled);
  const skillLevels = find('kuro-calculator-skills').querySelectorAll('input[type="number"]');
  skillLevels[0].value = '3'; skillLevels[1].value = '6';
  find('kuro-calculator-skills').querySelector('input[value="2-3"]').checked = true;
  find('kuro-calculator-skills').querySelector('input[value="3-5"]').checked = true;
  find('kuro-calculator-role-submit').click();
  await until(() => find('kuro-calculator-notice').textContent.includes('材料计算完成'));
  const calculatorRendered = find('kuro-calculator-all').textContent.includes('贝币');
  window.finish({roleLoaded, roleReloaded, briefingSelection, briefingRefresh, briefingEmpty, challengeTitles, floorStars, challengeCleared, calculatorRendered});
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
