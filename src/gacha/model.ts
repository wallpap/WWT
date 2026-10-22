export interface GachaRecord {
  playerId: string;
  gachaName: string;
  cardPoolType: string;
  resourceId: number;
  qualityLevel: number;
  resourceType: string;
  name: string;
  count: number;
  time: string;
}

export interface GachaSummary {
  totalPulls: number;
  totalStones: number;
  ssrCount: number;
  upSsrCount: number;
  nonBannerRate: number;
  srCount: number;
  rCount: number;
  averagePullsPerSsr: number;
  startTime: string | null;
  endTime: string | null;
  topSsr: string | null;
  rolePulls: number;
  roleSsr: number;
  roleAveragePullsPerSsr: number;
  weaponPulls: number;
  weaponSsr: number;
  weaponAveragePullsPerSsr: number;
  topUpSsr: string | null;
}
