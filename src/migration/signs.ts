import type { Database } from "bun:sqlite";
import type { LegacySign } from "../kujiequ/sign-store.ts";

export function readJavaSigns(db: Database): LegacySign[] {
  return db
    .query<Record<string, unknown>, []>("SELECT id, role_id, goods_name, goods_num, sign_date FROM sign_history ORDER BY sign_date, id")
    .all()
    .map((row) => {
      const roleId = row["role_id"];
      const date = row["sign_date"];
      const name = row["goods_name"];
      const id = row["id"];
      const count = row["goods_num"];
      // 订单号为 Java long，保持十进制字符串，避免超过 JS 安全整数范围时丢失精度。
      if (typeof roleId !== "string" || !/^\d+$/.test(roleId) || typeof date !== "string" || !date.trim() || typeof name !== "string" || !name.trim() || typeof id !== "bigint" || id <= 0n || typeof count !== "bigint" || count < 0n) throw new Error("旧版签到历史记录无效");
      return {
        roleId,
        record: { orderCode: String(id), date, name, count: String(count) },
      };
    });
}
