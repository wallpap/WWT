export const calculatorRules = {
  minimumLevel: 1,
  defaultLevel: 1,
  roleMaximumLevel: 90,
  weaponMaximumLevel: 90,
  roleSkillCount: 5,
  maximumSkillLevel: 10,
  skillAscensionTiers: [2, 3],
  minimumSkillBranch: 1,
  maximumSkillBranch: 5,
  inputStep: 1,
} as const;

export const skillNodeIdPattern = new RegExp(
  `^(?:${calculatorRules.skillAscensionTiers.join("|")})-[${calculatorRules.minimumSkillBranch}-${calculatorRules.maximumSkillBranch}]$`,
);
