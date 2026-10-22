import { importGachaRecords } from "../gacha/service.ts";
import { importGameTimeRecords } from "../game-time/import.ts";
import { readMigrationSource, type MigrationRecords, type MigrationSource } from "./read.ts";
import { challengeHistoryStore } from "../kujiequ/challenge-history.ts";
import { signHistoryStore } from "../kujiequ/sign-store.ts";
import { importLegacySettings } from "./settings.ts";
import type { LegacyAccount } from "../kujiequ/legacy-account.ts";
import { localArchiveStore } from "../local-data/store.ts";
import { emptyArchive } from "../local-data/model.ts";

interface MigrationExtraTargets {
  accounts?: (records: readonly LegacyAccount[]) => Promise<{ addedCount: number; duplicateCount: number }>;
  settings?: typeof importLegacySettings;
  archive?: typeof localArchiveStore.importLegacy;
}

export interface MigrationPreview {
  id: string;
  gachaCount: number;
  gachaPulls: number;
  gameTimeCount: number;
  gameTimeDuration: number;
  playerCount: number;
  challengeCount: number;
  signCount: number;
  accountRoleCount: number;
  settingCount: number;
  battleCount: number;
  localPlayerCount: number;
  catalogRoleCount: number;
}
export type MigrationKind = "gacha" | "game-time" | "challenges" | "signs" | "accounts" | "settings" | "archive";

export class MigrationService {
  #snapshot: { id: string; records: MigrationRecords } | null = null;
  #revision = 0;
  constructor(
    private readonly reader = readMigrationSource,
    private readonly importGacha = importGachaRecords,
    private readonly importTime = importGameTimeRecords,
    private readonly importChallenges = (records: NonNullable<MigrationRecords["challenges"]>) => challengeHistoryStore.importLegacy(records),
    private readonly importSigns = (records: NonNullable<MigrationRecords["signs"]>) => signHistoryStore.importLegacy(records),
    private readonly extra: MigrationExtraTargets = {},
  ) {}

  async preview(source: MigrationSource, path: string, playerId?: string): Promise<MigrationPreview> {
    const revision = ++this.#revision;
    this.#snapshot = null;
    const records = await this.reader(source, path, playerId);
    if (revision !== this.#revision) throw new Error("迁移来源已变化，请重新读取");
    const id = crypto.randomUUID();
    this.#snapshot = { id, records };
    return {
      id,
      gachaCount: records.gacha.length,
      gachaPulls: records.gacha.reduce((sum, row) => sum + row.count, 0),
      gameTimeCount: records.gameTime.length,
      gameTimeDuration: records.gameTime.reduce((sum, row) => sum + row.duration, 0),
      playerCount: new Set([...records.gacha.map((row) => row.playerId), ...records.gameTime.flatMap((row) => (row.roleId ? [row.roleId] : [])), ...(records.challenges ?? []).map((row) => row.roleId), ...(records.signs ?? []).map((row) => row.roleId), ...(records.accounts ?? []).map((row) => row.role.roleId), ...(records.archive?.battles ?? []).flatMap((row) => (row.roleId ? [row.roleId] : [])), ...(records.archive?.players ?? []).map((row) => row.roleId)]).size,
      challengeCount: records.challenges?.length ?? 0,
      signCount: records.signs?.length ?? 0,
      accountRoleCount: records.accounts?.length ?? 0,
      settingCount: records.settings ? Object.keys(records.settings.app).length + Object.keys(records.settings.game).length : 0,
      battleCount: records.archive?.battles.length ?? 0,
      localPlayerCount: records.archive?.players.length ?? 0,
      catalogRoleCount: records.archive?.roles.length ?? 0,
    };
  }

  async import(id: string, kind: MigrationKind): Promise<{ addedCount: number; duplicateCount: number }> {
    const snapshot = this.#snapshot;
    if (!snapshot || snapshot.id !== id) throw new Error("请重新读取迁移来源");
    if (kind === "gacha") {
      if (!snapshot.records.gacha.length) return { addedCount: 0, duplicateCount: 0 };
      const result = await this.importGacha(JSON.stringify(snapshot.records.gacha));
      return {
        addedCount: result.addedCount,
        duplicateCount: result.duplicateCount,
      };
    }
    if (kind === "game-time") {
      const result = await this.importTime(snapshot.records.gameTime);
      return {
        addedCount: result.addedCount,
        duplicateCount: result.duplicateCount,
      };
    }
    if (kind === "challenges") return this.importChallenges(snapshot.records.challenges ?? []);
    if (kind === "signs") return this.importSigns(snapshot.records.signs ?? []);
    if (kind === "accounts") {
      if (!this.extra.accounts) throw new Error("账号迁移暂不可用");
      return this.extra.accounts(snapshot.records.accounts ?? []);
    }
    if (kind === "settings") return (this.extra.settings ?? importLegacySettings)(snapshot.records.settings ?? { app: {}, game: {} });
    if (kind === "archive") return this.extra.archive ? this.extra.archive(snapshot.records.archive ?? emptyArchive()) : localArchiveStore.importLegacy(snapshot.records.archive ?? emptyArchive());
    throw new Error("迁移数据类型无效");
  }
}
