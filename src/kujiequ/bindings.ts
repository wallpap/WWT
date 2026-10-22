import { onCacheWarning } from "./optional-cache.ts";
import type { NativeWebview } from "../platform/native-webview.ts";
import type { AccountService } from "./accounts.ts";
import { verifyKuroCaptcha } from "./captcha.ts";
import { DailyService } from "./daily.ts";
import { SignService, type SignTarget } from "./sign.ts";
import { RoleService } from "./role.ts";
import { ChallengeService } from "./challenge.ts";
import { BriefingService } from "./briefing.ts";
import { CalculatorService } from "./calculator.ts";

export function bindKuroAccounts(webview: NativeWebview, accounts: AccountService, signs = new SignService(accounts)): void {
  onCacheWarning(() => webview.evaluate('window.dispatchEvent(new CustomEvent("desktop-error", { detail: "联网查询成功，本地缓存保存失败；请检查数据目录权限和剩余空间。" }))'));
  const daily = new DailyService(accounts);
  const roles = new RoleService(accounts);
  const challenges = new ChallengeService(accounts);
  const briefing = new BriefingService(accounts);
  const calculator = new CalculatorService(accounts);
  webview.bind("previewKuroBatchSign", () => signs.batchTargets());
  webview.bind("submitKuroBatchSign", (targets: SignTarget[]) => signs.submitBatch(targets));
  webview.bind("loadKuroSign", (force?: boolean) => signs.load(force));
  webview.bind("loadLocalKuroSignHistory", () => signs.localHistory());
  webview.bind("submitKuroSign", (accountId: string, roleId: string, serverId: string) => signs.submit(accountId, roleId, serverId));
  webview.bind("loadKuroDaily", (force: boolean, localOnly?: boolean) => daily.load(force, localOnly));
  webview.bind("syncKuroDaily", () => daily.synchronize());
  webview.bind("loadKuroAccounts", () => accounts.view());
  webview.bind("sendKuroSms", (phone: string) => accounts.sendSms(phone, verifyKuroCaptcha));
  webview.bind("loginKuroAccount", (phone: string, code: string) => accounts.login(phone, code));
  webview.bind("loginKuroToken", (token: string, did: string, source: "android" | "h5") => accounts.loginWithToken(token, did, source));
  webview.bind("selectKuroRole", (accountId: string, roleId: string) => {
    accounts.api.cancelRoleQueries();
    return accounts.select(accountId, roleId);
  });
  webview.bind("removeKuroAccount", (accountId: string) => accounts.remove(accountId));
  webview.bind("refreshKuroRoles", () => accounts.refresh());
  webview.bind("loadKuroRoleData", (force: boolean) => roles.load(force));
  webview.bind("loadLocalKuroRoleData", () => roles.local());
  webview.bind("loadKuroRoleDetail", (roleId: string, localOnly?: boolean) => roles.detail(roleId, localOnly));
  webview.bind("loadKuroChallenges", (force: boolean) => challenges.load(force));
  webview.bind("loadKuroChallengeHistory", () => challenges.history());
  webview.bind("loadKuroBriefingPeriods", (force: boolean, localOnly?: boolean) => briefing.periods(force, localOnly));
  webview.bind("loadKuroBriefingDetail", (kind: import("./briefing.ts").BriefingKind, index: string, force: boolean, localOnly?: boolean) => briefing.detail(kind, index, force, localOnly));
  webview.bind("loadKuroBriefingHistory", (kind: import("./briefing.ts").BriefingKind, synchronize: boolean) =>
    briefing.history(kind, synchronize, (completed, total) => {
      webview.evaluate(`window.dispatchEvent(new CustomEvent("briefing-history-progress", { detail: ${JSON.stringify({ completed, total })} }))`);
    }),
  );
  webview.bind("loadKuroCalculator", (force: boolean, localOnly?: boolean) => calculator.load(force, localOnly));
  webview.bind("calculateKuroRole", (aim: import("./calculator.ts").RoleAim) => calculator.roleCost(aim));
  webview.bind("loadKuroCultivation", (roleId: string) => calculator.cultivation(roleId));
  webview.bind("calculateKuroWeapon", (aim: import("./calculator.ts").WeaponAim) => calculator.weaponCost(aim));
  webview.bind("loadKuroCalculatorTargets", () => calculator.targets());
  webview.bind("saveKuroCalculatorTarget", (target: import("./calculator-targets.ts").CalculatorTarget) => calculator.saveTarget(target));
  webview.bind("removeKuroCalculatorTarget", (kind: "role" | "weapon", id: string) => calculator.removeTarget(kind, id));
  webview.bind("calculateKuroRoleBatch", (aims: import("./calculator.ts").RoleAim[]) => calculator.roleCosts(aims));
  webview.bind("calculateKuroWeaponBatch", (aims: import("./calculator.ts").WeaponAim[]) => calculator.weaponCosts(aims));
}
