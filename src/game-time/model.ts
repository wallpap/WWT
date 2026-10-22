export interface GameTimeRecord {
  id?: number;
  source?: "log" | "auto";
  roleId: string | null;
  gameDate: string;
  startTime: number;
  endTime: number;
  duration: number;
}

export interface GameTimeSummary {
  todayDuration: number;
  totalDuration: number;
  recordCount: number;
  byDate: Record<string, number>;
}
