import { object, serverId, type KuroRole } from "./model.ts";

export interface LegacyAccount {
  role: KuroRole;
  token: string;
  did: string;
  source: "h5" | "android";
  preferred: boolean;
}
export function parseLegacyAccount(value: unknown): LegacyAccount {
  const row = object(value);
  const role = object(row["role"]);
  if (!["roleId", "userId"].every((key) => typeof role[key] === "string" && /^\d+$/.test(role[key])) || !["roleName", "serverId", "serverName"].every((key) => typeof role[key] === "string") || !role["serverId"] || typeof row["token"] !== "string" || typeof row["did"] !== "string" || !["h5", "android"].includes(String(row["source"])) || typeof row["preferred"] !== "boolean") throw new Error("旧版账号数据格式无效");
  return {
    role: {
      roleId: String(role["roleId"]),
      userId: String(role["userId"]),
      roleName: String(role["roleName"]),
      serverId: String(role["serverId"]),
      serverName: String(role["serverName"]),
    },
    token: row["token"],
    did: row["did"],
    source: row["source"] as "h5" | "android",
    preferred: row["preferred"],
  };
}
export function nationalRole(userId: string, roleId: string, name: string): KuroRole {
  return {
    userId,
    roleId,
    roleName: name || roleId,
    serverId,
    serverName: "国服",
  };
}
