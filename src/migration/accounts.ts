import { Database } from "bun:sqlite";
import { nationalRole, parseLegacyAccount, type LegacyAccount } from "../kujiequ/legacy-account.ts";

export function readJavaAccounts(path: string): LegacyAccount[] {
  const db = new Database(path, { readonly: true, safeIntegers: true });
  try {
    return db
      .query<Record<string, unknown>, []>("SELECT user_id, role_id, role_name, token, dev_code, is_web, is_main FROM user_info ORDER BY id")
      .all()
      .map((row) =>
        parseLegacyAccount({
          role: nationalRole(typeof row["user_id"] === "string" ? row["user_id"] : "", typeof row["role_id"] === "string" ? row["role_id"] : "", typeof row["role_name"] === "string" ? row["role_name"] : ""),
          token: row["token"] ?? "",
          did: row["dev_code"] ?? "",
          source: row["is_web"] === 1n ? "h5" : "android",
          preferred: row["is_main"] === 1n,
        }),
      );
  } catch {
    throw new Error("读取原版账号失败，请选择包含 user_info 的原版数据库");
  } finally {
    db.close();
  }
}
