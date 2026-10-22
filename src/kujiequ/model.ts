export interface KuroRole {
  roleId: string;
  roleName: string;
  userId: string;
  serverId: string;
  serverName: string;
}
export interface KuroSession {
  id: string;
  label: string;
  token: string;
  did: string;
  source: "h5" | "android";
  roles: KuroRole[];
}
export interface AccountState {
  accounts: KuroSession[];
  selectedAccountId: string | null;
  selectedRoleId: string | null;
}
export interface AccountView {
  accounts: { id: string; label: string; roles: KuroRole[] }[];
  selectedAccountId: string | null;
  selectedRoleId: string | null;
}
export const serverId = "76402e5b20be2c39f095a152090afddc";

export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("库街区返回的数据格式无效");
  return value as Record<string, unknown>;
}
export function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : "";
}
export function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : 0;
}
export function bool(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}
export function decode(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("库街区返回的数据格式无效");
  }
}
