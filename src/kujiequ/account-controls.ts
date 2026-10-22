import type { AccountView } from "./model.ts";
import { secondsPerMinute } from "../units.ts";

export function initializeAccountControls(): void {
  const find = <T extends HTMLElement>(id: string) => document.querySelector<T>(`#${id}`)!;
  const form = find<HTMLFormElement>("kuro-login-form");
  const phone = find<HTMLInputElement>("kuro-phone");
  const code = find<HTMLInputElement>("kuro-code");
  const account = find<HTMLSelectElement>("kuro-account");
  const role = find<HTMLSelectElement>("kuro-role");
  const notice = find<HTMLElement>("kuro-account-notice");
  const fields = find<HTMLFieldSetElement>("kuro-account-fields");
  const loginMethods = [
    { tab: find<HTMLButtonElement>("kuro-sms-tab"), panel: form },
    {
      tab: find<HTMLButtonElement>("kuro-token-tab"),
      panel: find<HTMLFormElement>("kuro-token-form"),
    },
  ];
  function selectLoginMethod(index: number, focus = false): void {
    loginMethods.forEach((method, current) => {
      const selected = current === index;
      method.tab.setAttribute("aria-selected", String(selected));
      method.tab.tabIndex = selected ? 0 : -1;
      method.panel.hidden = !selected;
    });
    if (focus) loginMethods[index]!.tab.focus();
  }
  loginMethods.forEach((method, index) => {
    method.tab.addEventListener("click", () => selectLoginMethod(index));
    method.tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      selectLoginMethod(event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index, true);
    });
  });
  let state: AccountView = {
    accounts: [],
    selectedAccountId: null,
    selectedRoleId: null,
  };
  let busy = false;

  function render(next: AccountView): void {
    state = next;
    account.replaceChildren(...(state.accounts.length ? state.accounts.map((item) => new Option(item.label, item.id)) : [new Option("尚未添加账号", "")]));
    account.disabled = state.accounts.length === 0;
    account.value = state.selectedAccountId ?? "";
    const selected = state.accounts.find((item) => item.id === state.selectedAccountId);
    const roles = selected?.roles ?? [];
    role.replaceChildren(...(roles.length ? roles.map((item) => new Option(`${item.roleName} · ${item.roleId}${item.serverName ? ` · ${item.serverName}` : ""}`, item.roleId)) : [new Option(selected ? "暂未绑定鸣潮角色" : "登录后选择角色", "")]));
    role.disabled = roles.length === 0;
    role.value = state.selectedRoleId ?? "";
    find<HTMLButtonElement>("kuro-remove").disabled = !selected;
    find<HTMLButtonElement>("kuro-refresh-roles").disabled = !selected;
    notice.textContent = selected ? `已选择 ${selected.label}，共 ${selected.roles.length} 个绑定角色` : "登录后选择鸣潮角色。";
    window.dispatchEvent(new Event("kuro-account-changed"));
  }
  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    fields.disabled = true;
    notice.dataset["kind"] = "info";
    try {
      await action();
    } catch (error) {
      account.value = state.selectedAccountId ?? "";
      role.value = state.selectedRoleId ?? "";
      notice.textContent = typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : "库街区操作失败";
      notice.dataset["kind"] = "error";
    } finally {
      busy = false;
      fields.disabled = false;
    }
  }
  find<HTMLButtonElement>("kuro-send-sms").addEventListener("click", () => {
    void run(async () => {
      notice.textContent = "请在浏览器完成滑块验证，完成后发送短信…";
      await window.sendKuroSms(phone.value.trim());
      notice.textContent = `短信已发送，请输入验证码登录。再次发送需间隔 ${secondsPerMinute} 秒。`;
    });
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void run(async () => {
      notice.textContent = "正在登录并获取绑定角色…";
      const value = code.value.trim();
      code.value = "";
      render(await window.loginKuroAccount(phone.value.trim(), value));
    });
  });
  find<HTMLFormElement>("kuro-token-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void run(async () => {
      notice.textContent = "正在验证凭据并获取绑定角色…";
      const token = find<HTMLInputElement>("kuro-token"),
        did = find<HTMLInputElement>("kuro-did");
      const value = token.value.trim(),
        device = did.value.trim();
      const source = find<HTMLSelectElement>("kuro-token-source").value as "android" | "h5";
      token.value = "";
      did.value = "";
      render(await window.loginKuroToken(value, device, source));
    });
  });
  account.addEventListener("change", () => {
    void run(async () => {
      const first = state.accounts.find((item) => item.id === account.value)?.roles[0];
      if (first) render(await window.selectKuroRole(account.value, first.roleId));
    });
  });
  role.addEventListener("change", () => {
    void run(async () => render(await window.selectKuroRole(account.value, role.value)));
  });
  find<HTMLButtonElement>("kuro-remove").addEventListener("click", () => {
    void run(async () => render(await window.removeKuroAccount(account.value)));
  });
  find<HTMLButtonElement>("kuro-refresh-roles").addEventListener("click", () => {
    void run(async () => render(await window.refreshKuroRoles()));
  });
  void run(async () => render(await window.loadKuroAccounts()));
  window.addEventListener("kuro-accounts-imported", () => {
    void run(async () => render(await window.loadKuroAccounts()));
  });
}
