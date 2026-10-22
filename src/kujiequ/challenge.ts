import { saveOptionalCache } from "./optional-cache.ts";
import type { AccountService } from "./accounts.ts";
import { decode, bool, number, object, text, serverId, type KuroRole, type KuroSession } from "./model.ts";
import { ChallengeHistoryStore, challengeHistoryStore, legacyChallengeKey, type ChallengeSnapshot } from "./challenge-history.ts";
import { challengeSnapshots } from "./challenge-history.ts";
import { queryCacheStore, queryScope, type QueryCacheStore } from "./query-cache.ts";
import { millisecondsPerMinute, unixTimestampMillisecondsThreshold } from "../units.ts";

export interface ChallengeRole {
  id: string;
  name: string;
  iconUrl: string;
  skillBranch: number | null;
}
export interface ChallengeBuff {
  id: string;
  name: string;
  description: string;
  iconUrl: string;
  quality: number;
}
export interface TowerFloorView {
  floor: string;
  stars: number;
  roleCount: number;
  roles?: ChallengeRole[];
}
export interface TowerAreaView {
  name: string;
  stars: number;
  maxStars: number;
  floors: TowerFloorView[];
}
export interface TowerView {
  unlocked: boolean;
  seasonEndTime: number;
  areas: TowerAreaView[];
}
export interface SlashHalfView {
  name: string;
  score: number;
  roleCount: number;
  roles?: ChallengeRole[];
  buffs?: ChallengeBuff[];
}
export interface SlashChallengeView {
  name: string;
  score: number;
  rank: string;
  halves: SlashHalfView[];
}
export interface SlashDifficultyView {
  name: string;
  score: number;
  maxScore: number;
  challenges: SlashChallengeView[];
}
export interface SlashView {
  unlocked: boolean;
  seasonEndTime: number;
  difficulties: SlashDifficultyView[];
}
export interface NewTowerTeamView {
  score: number;
  round: number;
  passBoss: number;
  roleCount: number;
  bossCount?: number;
  roles?: ChallengeRole[];
  buffs?: ChallengeBuff[];
}
export interface NewTowerModeView {
  modeId: number;
  score: number;
  rank: number;
  round: number;
  passBoss: number;
  bossCount: number;
  hasRecord: boolean;
  teams: NewTowerTeamView[];
}
export interface NewTowerView {
  unlocked: boolean;
  endTime: number;
  reward: number;
  totalReward: number;
  modes: NewTowerModeView[];
}
export interface ChallengeView {
  roleId: string;
  roleName: string;
  updatedAt: number;
  tower: TowerView;
  slash: SlashView;
  newTower: NewTowerView;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function parseTeam(row: Record<string, unknown>): ChallengeRole[] {
  const roles = list(row["roleList"]),
    icons = list(row["roleIcons"]);
  if (!roles.length)
    return icons.map((icon, index) => ({
      id: "",
      name: `位置 ${index + 1}`,
      iconUrl: text(icon),
      skillBranch: null,
    }));
  return roles.map((value, index) => {
    const role = object(value),
      id = text(role["roleId"]);
    return {
      id,
      name: text(role["roleName"]) || id || `位置 ${index + 1}`,
      iconUrl: text(role["iconUrl"]) || text(role["roleIconUrl"]) || text(icons[index]),
      skillBranch: role["skillBranchIndex"] == null ? null : number(role["skillBranchIndex"]),
    };
  });
}
function parseBuff(value: unknown): ChallengeBuff {
  const row = object(value);
  return {
    id: text(row["buffId"]),
    name: text(row["buffName"]),
    description: text(row["desc"]) || text(row["buffDescription"]),
    iconUrl: text(row["buffIcon"]),
    quality: number(row["buffQuality"]),
  };
}
export function challengeDeadline(value: unknown, observedAt: number): number {
  const milliseconds = number(value);
  if (milliseconds <= 0) return 0;
  return milliseconds >= unixTimestampMillisecondsThreshold ? milliseconds : observedAt + milliseconds;
}

export function parseTower(value: unknown, observedAt = Date.now()): TowerView {
  const data = object(decode(value));
  return {
    unlocked: bool(data["isUnlock"]),
    seasonEndTime: challengeDeadline(data["seasonEndTime"], observedAt),
    areas: list(data["difficultyList"]).flatMap((difficulty) => {
      const group = object(difficulty);
      return list(group["towerAreaList"]).map((area) => {
        const row = object(area);
        return {
          name: text(row["areaName"]) || `区域 ${number(row["areaId"])}`,
          stars: number(row["star"]),
          maxStars: number(row["maxStar"]),
          floors: list(row["floorList"]).map((floor) => {
            const item = object(floor);
            const roles = parseTeam(item);
            return {
              floor: text(item["floor"]) || "-",
              stars: number(item["star"]),
              roleCount: roles.length,
              roles,
            };
          }),
        } satisfies TowerAreaView;
      });
    }),
  };
}

export function parseSlash(value: unknown, observedAt = Date.now()): SlashView {
  const data = object(decode(value));
  return {
    unlocked: bool(data["isUnlock"]),
    seasonEndTime: challengeDeadline(data["seasonEndTime"], observedAt),
    difficulties: list(data["difficultyList"]).map((difficulty) => {
      const group = object(difficulty);
      return {
        name: text(group["difficultyName"]) || `难度 ${number(group["difficulty"])}`,
        score: number(group["allScore"]),
        maxScore: number(group["maxScore"]),
        challenges: list(group["challengeList"]).map((challenge) => {
          const row = object(challenge);
          return {
            name: text(row["challengeName"]) || `挑战 ${number(row["challengeId"])}`,
            score: number(row["score"]),
            rank: text(row["rank"]),
            halves: list(row["halfList"]).map((half) => {
              const item = object(half);
              const roles = parseTeam(item);
              return {
                name: text(item["buffName"]),
                score: number(item["score"]),
                roleCount: roles.length,
                roles,
                buffs: [parseBuff(item)].filter((buff) => buff.name || buff.description || buff.id),
              } satisfies SlashHalfView;
            }),
          } satisfies SlashChallengeView;
        }),
      } satisfies SlashDifficultyView;
    }),
  };
}

export function parseNewTower(value: unknown, observedAt = Date.now()): NewTowerView {
  const data = object(decode(value));
  return {
    unlocked: bool(data["isUnlock"]),
    endTime: challengeDeadline(data["endTime"], observedAt),
    reward: number(data["reward"]),
    totalReward: number(data["totalReward"]),
    modes: list(data["modeDetails"]).map((mode) => {
      const row = object(mode);
      return {
        modeId: number(row["modeId"]),
        score: number(row["score"]),
        rank: number(row["rank"]),
        round: number(row["round"]),
        passBoss: number(row["passBoss"]),
        bossCount: number(row["bossCount"]),
        hasRecord: bool(row["hasRecord"]),
        teams: list(row["teams"]).map((team) => {
          const item = object(team);
          const roles = parseTeam(item);
          return {
            score: number(item["score"]),
            round: number(item["round"]),
            passBoss: number(item["passBoss"]),
            roleCount: roles.length,
            bossCount: number(item["bossCount"]),
            roles,
            buffs: list(item["buffs"]).map(parseBuff),
          } satisfies NewTowerTeamView;
        }),
      } satisfies NewTowerModeView;
    }),
  };
}

export class ChallengeService {
  #cache = new Map<string, ChallengeView>();
  constructor(
    private readonly accounts: AccountService,
    private readonly historyStore: Pick<ChallengeHistoryStore, "merge" | "list"> = challengeHistoryStore,
    private readonly queries: Pick<QueryCacheStore, "read"> = queryCacheStore,
  ) {}

  async history(): Promise<ChallengeSnapshot[]> {
    const { session, role } = await this.accounts.context();
    const current = await this.historyStore.list(JSON.stringify([session.id, role.roleId, role.serverId]));
    const legacy = role.serverId === serverId ? await this.historyStore.list(legacyChallengeKey(role.roleId)) : [];
    const imported: ChallengeSnapshot[] = [];
    const scope = queryScope(session, role);
    for (const kind of ["tower", "slash", "matrix"] as const) {
      const entry = await this.queries.read(scope, kind);
      if (!entry) continue;
      const view: ChallengeView = {
        roleId: role.roleId,
        roleName: role.roleName,
        updatedAt: entry.savedAt,
        tower: parseTower({}),
        slash: parseSlash({}),
        newTower: parseNewTower({}),
      };
      if (kind === "tower") view.tower = entry.data as TowerView;
      else if (kind === "slash") view.slash = entry.data as SlashView;
      else view.newTower = entry.data as NewTowerView;
      imported.push(...challengeSnapshots(view));
    }
    return [...new Map([...imported, ...legacy, ...current].map((item) => [item.id, item])).values()].sort((a, b) => b.endTime - a.endTime);
  }

  async load(force = false): Promise<ChallengeView> {
    const { session, role } = await this.accounts.context();
    const key = `${session.id}:${role.roleId}:${role.serverId}`;
    const cached = this.#cache.get(key);
    if (!force && cached && Date.now() - cached.updatedAt < millisecondsPerMinute) return cached;
    const [tower, slash, newTower] = await Promise.all([this.accounts.api.roleRequest("/aki/roleBox/akiBox/towerDataDetail", session, role, {}, { multipart: true }).then((raw) => parseTower(raw)), this.accounts.api.roleRequest("/aki/roleBox/akiBox/slashDetail", session, role, {}, { query: true, sessionToken: false }).then((raw) => parseSlash(raw)), this.accounts.api.roleRequest("/aki/roleBox/akiBox/newTowerDetail", session, role, {}, { multipart: true }).then((raw) => parseNewTower(raw))]);
    const view = {
      roleId: role.roleId,
      roleName: role.roleName,
      updatedAt: Date.now(),
      tower,
      slash,
      newTower,
    } satisfies ChallengeView;
    await saveOptionalCache(this.historyStore.merge(JSON.stringify([session.id, role.roleId, role.serverId]), view));
    this.#cache.set(key, view);
    return view;
  }
}
