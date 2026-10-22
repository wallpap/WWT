import { calculatorSkillNames } from "./calculator-aim.ts";
import { decode, object, text } from "./model.ts";
import { calculatorRules, skillNodeIdPattern } from "./calculator-rules.ts";

export interface RoleCultivation {
  roleId: string;
  roleLevel: number;
  skillLevels: number[];
  unlockedNodes: string[];
}

export function parseRoleCultivation(value: unknown, roleId: string): RoleCultivation {
  const data = decode(value);
  if (!Array.isArray(data)) throw new Error("角色练度数据格式无效");
  const row = data.map(object).find((item) => text(item["roleId"]) === roleId);
  if (!row) throw new Error("当前账号没有该角色的练度数据");
  const roleLevel = row["roleLevel"];
  const levels = row["skillLevelList"];
  const nodes = row["skillBreakList"];
  if (typeof roleLevel !== "number" || !Number.isInteger(roleLevel) || roleLevel < calculatorRules.minimumLevel || roleLevel > calculatorRules.roleMaximumLevel || !Array.isArray(levels) || !Array.isArray(nodes) || nodes.some((id) => typeof id !== "string" || !skillNodeIdPattern.test(id))) throw new Error("角色练度数据格式无效");
  const byType = new Map<string, unknown>();
  for (const value of levels) {
    const skill = object(value);
    const type = text(skill["type"]);
    if (byType.has(type)) throw new Error("角色练度包含重复技能类型");
    byType.set(type, skill["level"]);
  }
  // 接口包含延奏、谐度破坏等不可升级技能，按类型读取可养成的五项。
  const skillLevels = calculatorSkillNames.map((type) => {
    const level = byType.get(type);
    if (typeof level !== "number" || !Number.isInteger(level) || level < calculatorRules.minimumLevel || level > calculatorRules.maximumSkillLevel) throw new Error(`角色${type}等级无效`);
    return level;
  });
  return {
    roleId,
    roleLevel,
    skillLevels,
    unlockedNodes: [...new Set(nodes as string[])],
  };
}
