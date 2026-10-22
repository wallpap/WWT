import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { appPaths } from "../platform/app-paths.ts";
import { protectLocalData } from "../platform/protected-data.ts";
import { object, type AccountState } from "./model.ts";

export class AccountStore {
  constructor(private readonly path = join(appPaths.dataDirectory, "kujiequ-session.bin")) {}
  async read(): Promise<AccountState> {
    let bytes: Buffer;
    try {
      bytes = await readFile(this.path);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return { accounts: [], selectedAccountId: null, selectedRoleId: null };
      throw new Error("读取库街区会话失败");
    }
    const plain = protectLocalData(bytes, true);
    try {
      const state = object(JSON.parse(new TextDecoder().decode(plain)) as unknown);
      if (!Array.isArray(state["accounts"])) throw new Error();
      for (const entry of state["accounts"]) {
        const account = object(entry);
        if (!["id", "label", "token", "did"].every((key) => typeof account[key] === "string") || !["h5", "android"].includes(String(account["source"])) || !Array.isArray(account["roles"])) throw new Error();
        for (const role of account["roles"]) if (!["roleId", "roleName", "userId", "serverId", "serverName"].every((key) => typeof object(role)[key] === "string")) throw new Error();
      }
      if (![state["selectedAccountId"], state["selectedRoleId"]].every((value) => value === null || typeof value === "string")) throw new Error();
      return state as unknown as AccountState;
    } catch {
      throw new Error("本地库街区会话格式无效");
    } finally {
      plain.fill(0);
    }
  }
  async write(state: AccountState): Promise<void> {
    const plain = new TextEncoder().encode(JSON.stringify(state));
    let encrypted: Uint8Array;
    try {
      encrypted = protectLocalData(plain);
    } finally {
      plain.fill(0);
    }
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${crypto.randomUUID()}.tmp`;
    try {
      await Bun.write(temporary, encrypted);
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
