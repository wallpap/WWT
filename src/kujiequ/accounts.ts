import { KuroApi } from "./api.ts";
import { AccountStore } from "./store.ts";
import { object, text, type AccountState, type AccountView, type KuroSession } from "./model.ts";
import { parseLegacyAccount, type LegacyAccount } from "./legacy-account.ts";
import { millisecondsPerMinute } from "../units.ts";
import { maximumSavedKuroAccounts } from "./constants.ts";

const mainlandPhonePattern = /^1[3-9]\d{9}$/;
const smsVerificationCodePattern = /^\d{4,8}$/;

export class AccountService {
  #queue: Promise<unknown> = Promise.resolve();
  #device = crypto.randomUUID().replaceAll("-", "");
  #smsAfter = 0;
  constructor(
    readonly api = new KuroApi(),
    private readonly store: Pick<AccountStore, "read" | "write"> = new AccountStore(),
  ) {}

  #serialize<T>(task: () => Promise<T>): Promise<T> {
    const operation = this.#queue.then(task);
    this.#queue = operation.catch(() => {});
    return operation;
  }
  #view(state: AccountState): AccountView {
    return {
      ...state,
      accounts: state.accounts.map(({ id, label, roles }) => ({
        id,
        label,
        roles,
      })),
    };
  }
  view(): Promise<AccountView> {
    return this.#serialize(async () => this.#view(await this.store.read()));
  }

  importLegacy(incoming: readonly LegacyAccount[]): Promise<{ addedCount: number; duplicateCount: number }> {
    return this.#serialize(async () => {
      const validated = incoming.map(parseLegacyAccount);
      const state = structuredClone(await this.store.read());
      const previousSelection = state.selectedAccountId;
      let addedCount = 0;
      for (const entry of validated) {
        let account = state.accounts.find((item) => item.roles.some((role) => role.userId === entry.role.userId));
        if (!account) {
          if (state.accounts.length >= maximumSavedKuroAccounts) throw new Error(`迁移后账号数超过 ${maximumSavedKuroAccounts} 个，请先整理账号`);
          account = {
            id: crypto.randomUUID(),
            label: `迁移账号 ${state.accounts.length + 1}${entry.token ? "" : "（需重新登录）"}`,
            token: entry.token,
            did: entry.did || crypto.randomUUID().replaceAll("-", ""),
            source: entry.source,
            roles: [],
          };
          state.accounts.push(account);
        }
        if (account.roles.some((role) => role.roleId === entry.role.roleId && role.serverId === entry.role.serverId)) continue;
        account.roles.push({ ...entry.role });
        addedCount++;
      }
      if (!state.selectedAccountId && validated.length) {
        const preferred = validated.find((item) => item.preferred) ?? validated[0]!;
        const account = state.accounts.find((item) => item.roles.some((role) => role.userId === preferred.role.userId));
        if (account) {
          state.selectedAccountId = account.id;
          state.selectedRoleId = preferred.role.roleId;
        }
      }
      if (addedCount || state.selectedAccountId !== previousSelection) await this.store.write(state);
      return { addedCount, duplicateCount: validated.length - addedCount };
    });
  }

  async sendSms(phone: string, verify: () => Promise<Record<string, string>>): Promise<void> {
    if (!mainlandPhonePattern.test(phone)) throw new Error("请输入有效的中国大陆手机号");
    if (Date.now() < this.#smsAfter) throw new Error("请稍后再发送短信验证码");
    this.#smsAfter = Date.now() + millisecondsPerMinute;
    const result = await verify();
    const data = Object.fromEntries(
      ["captcha_id", "lot_number", "pass_token", "gen_time", "captcha_output"].map((key) => {
        if (!result[key]) throw new Error("滑块验证结果不完整，请重试");
        return [key, result[key]];
      }),
    );
    this.api.success(await this.api.send("/user/getSmsCodeForH5", { token: "", did: this.#device, source: "h5" }, { mobile: phone, geeTestData: JSON.stringify(data) }));
  }

  login(phone: string, code: string): Promise<AccountView> {
    return this.#serialize(async () => {
      if (!mainlandPhonePattern.test(phone) || !smsVerificationCodePattern.test(code)) throw new Error("请输入有效的手机号和短信验证码");
      // 角色授权要求客户端会话；H5 会话可查签到，但不能用于 Android 角色授权。
      const data = object(this.api.success(await this.api.send("/user/sdkLogin", { token: "", did: this.#device, source: "android" }, { mobile: phone, code, devCode: this.#device }, { query: true })));
      const token = text(data["token"]);
      if (!token) throw new Error("登录响应缺少会话凭据");
      const session: KuroSession = {
        id: crypto.randomUUID(),
        label: `${phone.slice(0, 3)}****${phone.slice(-4)}`,
        token,
        did: this.#device,
        source: "android",
        roles: [],
      };
      const view = await this.#saveSession(session);
      this.#device = crypto.randomUUID().replaceAll("-", "");
      return view;
    });
  }

  loginWithToken(token: string, did: string, source: KuroSession["source"] = "android"): Promise<AccountView> {
    return this.#serialize(async () => {
      if (typeof token !== "string" || !token.trim() || typeof did !== "string" || !did.trim()) throw new Error("请输入 Token 和 Did");
      token = token.trim();
      did = did.trim();
      if (!/^[\x21-\x7e]+$/.test(token) || !/^[\x21-\x7e]+$/.test(did)) throw new Error("Token 或 Did 包含无效字符");
      if (source !== "android" && source !== "h5") throw new Error("请选择有效的凭据来源");
      return this.#saveSession({
        id: crypto.randomUUID(),
        label: "",
        token,
        did,
        source,
        roles: [],
      });
    });
  }

  async #saveSession(session: KuroSession): Promise<AccountView> {
    session.roles = await this.api.roles(session);
    if (!session.roles.length) throw new Error("该账号尚未绑定鸣潮角色，请先在库街区绑定");
    const state = await this.store.read();
    const previous = state.accounts.find((account) => account.roles.some((role) => role.userId === session.roles[0]!.userId));
    if (!session.label) session.label = previous?.label || session.roles[0]!.roleName || "Token 账号";
    if (previous) {
      session.id = previous.id;
      this.api.clearAccess(previous.id);
    } else if (state.accounts.length >= maximumSavedKuroAccounts) throw new Error(`最多保存 ${maximumSavedKuroAccounts} 个库街区账号`);
    state.accounts = [...state.accounts.filter((account) => account.id !== session.id), session];
    state.selectedAccountId = session.id;
    state.selectedRoleId = session.roles[0]!.roleId;
    await this.store.write(state);
    return this.#view(state);
  }

  select(accountId: string, roleId: string): Promise<AccountView> {
    return this.#serialize(async () => {
      const state = await this.store.read();
      if (!state.accounts.find((account) => account.id === accountId)?.roles.some((role) => role.roleId === roleId)) throw new Error("所选账号或角色不存在");
      state.selectedAccountId = accountId;
      state.selectedRoleId = roleId;
      await this.store.write(state);
      return this.#view(state);
    });
  }
  remove(accountId: string): Promise<AccountView> {
    return this.#serialize(async () => {
      const state = await this.store.read();
      state.accounts = state.accounts.filter((account) => account.id !== accountId);
      if (state.selectedAccountId === accountId) {
        state.selectedAccountId = state.accounts[0]?.id ?? null;
        state.selectedRoleId = state.accounts[0]?.roles[0]?.roleId ?? null;
      }
      await this.store.write(state);
      this.api.clearAccess(accountId);
      return this.#view(state);
    });
  }
  refresh(): Promise<AccountView> {
    return this.#serialize(async () => {
      const state = await this.store.read();
      const session = state.accounts.find((account) => account.id === state.selectedAccountId);
      if (!session) throw new Error("请先登录库街区账号");
      session.roles = await this.api.roles(session);
      if (!session.roles.some((role) => role.roleId === state.selectedRoleId)) state.selectedRoleId = session.roles[0]?.roleId ?? null;
      await this.store.write(state);
      return this.#view(state);
    });
  }
  context(accountId?: string, roleId?: string) {
    return this.#serialize(async () => {
      const state = await this.store.read();
      const session = state.accounts.find((account) => account.id === (accountId ?? state.selectedAccountId));
      const role = session?.roles.find((role) => role.roleId === (roleId ?? state.selectedRoleId));
      if (!session || !role) throw new Error("请先登录库街区并选择角色");
      return { session, role };
    });
  }
}
