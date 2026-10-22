import type { RoleAim, SkillLevelUp, WeaponAim } from "./calculator.ts";
import { calculatorRules, skillNodeIdPattern } from "./calculator-rules.ts";

export const calculatorSkillNames = ["常态攻击", "共鸣技能", "共鸣回路", "共鸣解放", "变奏技能"] as const;
function validLevels(start: number, end: number, max: number): boolean {
  return Number.isInteger(start) && Number.isInteger(end) && start >= calculatorRules.minimumLevel && start <= end && end <= max;
}
export function buildRoleAim(roleId: string, startLevel: number, endLevel: number, skills: readonly SkillLevelUp[], advanceSkills: readonly string[] = [], category: "all" | "self" = "all"): RoleAim {
  if (!/^\d+$/.test(roleId) || !validLevels(startLevel, endLevel, calculatorRules.roleMaximumLevel) || skills.length !== calculatorRules.roleSkillCount || skills.some((skill) => !validLevels(skill.startLevel, skill.endLevel, calculatorRules.maximumSkillLevel)) || advanceSkills.some((id) => !skillNodeIdPattern.test(id)) || !["all", "self"].includes(category)) throw new Error("角色养成目标无效");
  return {
    roleId,
    roleStartLevel: startLevel,
    roleEndLevel: endLevel,
    skillLevelUpList: skills.map((skill) => ({
      startLevel: skill.startLevel,
      endLevel: skill.endLevel,
    })),
    advanceSkillList: [...new Set(advanceSkills)],
    category,
  };
}
export function buildWeaponAim(weaponId: string, startLevel: number, endLevel: number): WeaponAim {
  if (!/^\d+$/.test(weaponId) || !validLevels(startLevel, endLevel, calculatorRules.weaponMaximumLevel)) throw new Error("武器养成目标无效");
  return { weaponId, weaponStartLevel: startLevel, weaponEndLevel: endLevel };
}
