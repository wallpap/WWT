import type { BriefingKind, BriefingView } from "./briefing.ts";

export interface BriefingTrendRow {
  view: BriefingView;
  starChange: number | null;
  coinChange: number | null;
}
export interface BriefingHistory {
  kind: BriefingKind;
  rows: BriefingTrendRow[];
  totalStar: number;
  totalCoin: number;
  averageStar: number;
  averageCoin: number;
}
export function summarizeBriefingHistory(views: readonly BriefingView[], kind: BriefingKind): BriefingHistory {
  const latest = new Map<string, BriefingView>();
  for (const view of views.filter((view) => view.kind === kind)) {
    const previous = latest.get(view.period.index);
    if (!previous || previous.updatedAt < view.updatedAt) latest.set(view.period.index, view);
  }
  const ordered = [...latest.values()].sort((a, b) => a.period.index.localeCompare(b.period.index, "en", { numeric: true }));
  const rows = ordered.map((view, index) => ({
    view,
    starChange: index ? view.record.totalStar - ordered[index - 1]!.record.totalStar : null,
    coinChange: index ? view.record.totalCoin - ordered[index - 1]!.record.totalCoin : null,
  }));
  const totalStar = ordered.reduce((sum, view) => sum + view.record.totalStar, 0),
    totalCoin = ordered.reduce((sum, view) => sum + view.record.totalCoin, 0);
  return {
    kind,
    rows,
    totalStar,
    totalCoin,
    averageStar: rows.length ? totalStar / rows.length : 0,
    averageCoin: rows.length ? totalCoin / rows.length : 0,
  };
}
