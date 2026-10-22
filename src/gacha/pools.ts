import type { GachaRecord } from "./model.ts";

export const gachaPoolNames = ["角色活动唤取", "武器活动唤取", "角色常驻唤取", "武器常驻唤取", "新手唤取", "新手自选唤取", "新手自选唤取（感恩定向唤取）", "角色新旅唤取", "武器新旅唤取", "角色联动唤取", "武器联动唤取", "角色忆旅唤取", "武器忆旅唤取"] as const;
export const gachaPoolCode = {
  characterEvent: 1,
  weaponEvent: 2,
  residentCharacter: 3,
  residentWeapon: 4,
  beginner: 5,
  beginnerChoice: 6,
  beginnerGratitudeChoice: 7,
  characterJourney: 8,
  weaponJourney: 9,
  characterCollaboration: 10,
  weaponCollaboration: 11,
  characterMemory: 12,
  weaponMemory: 13,
} as const;
export const gachaPoolCodePattern = new RegExp(`^(?:${Object.values(gachaPoolCode).join("|")})$`);
const firstGachaPoolCode = gachaPoolCode.characterEvent;
const weaponPoolCodes: ReadonlySet<number> = new Set([gachaPoolCode.weaponEvent, gachaPoolCode.residentWeapon, gachaPoolCode.weaponJourney, gachaPoolCode.weaponCollaboration, gachaPoolCode.weaponMemory]);
const aliases = new Map<string, number>(gachaPoolNames.map((name, index) => [name, index + firstGachaPoolCode]));
for (const [name, code] of [
  ["角色活动", gachaPoolCode.characterEvent],
  ["角色精准调谐", gachaPoolCode.characterEvent],
  ["武器活动", gachaPoolCode.weaponEvent],
  ["武器精准调谐", gachaPoolCode.weaponEvent],
  ["角色常驻", gachaPoolCode.residentCharacter],
  ["角色调谐（常驻池）", gachaPoolCode.residentCharacter],
  ["武器常驻", gachaPoolCode.residentWeapon],
  ["武器调谐（常驻池）", gachaPoolCode.residentWeapon],
  ["新手调谐", gachaPoolCode.beginner],
] as const)
  aliases.set(name, code);

function codeOf(value: string): number | undefined {
  return gachaPoolCodePattern.test(value) ? Number(value) : aliases.get(value);
}

export function gachaPool(record: GachaRecord): {
  key: string;
  name: string;
  kind: "role" | "weapon" | "unknown";
  roleBanner: boolean;
} {
  const confirmed = codeOf(record.cardPoolType);
  const code = confirmed ?? codeOf(record.gachaName);
  return {
    key: confirmed === undefined ? JSON.stringify([record.cardPoolType, record.gachaName]) : String(confirmed),
    name: (code ? gachaPoolNames[code - firstGachaPoolCode] : undefined) ?? record.gachaName,
    kind: code === undefined ? "unknown" : weaponPoolCodes.has(code) ? "weapon" : "role",
    roleBanner: code === gachaPoolCode.characterEvent,
  };
}
