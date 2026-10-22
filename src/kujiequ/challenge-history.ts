import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { appPaths } from "../platform/app-paths.ts";
import type { ChallengeView, NewTowerView, SlashView, TowerView } from "./challenge.ts";
import { object, serverId } from "./model.ts";
import { millisecondsPerHour } from "../units.ts";

interface SnapshotBase {
  id: string;
  endTime: number;
  updatedAt: number;
}
export type ChallengeSnapshot = SnapshotBase & ({ kind: "tower"; data: TowerView } | { kind: "slash"; data: SlashView } | { kind: "new-tower"; data: NewTowerView });
export interface LegacyChallenge {
  roleId: string;
  snapshot: ChallengeSnapshot;
}
export function legacyChallengeKey(roleId: string): string {
  return JSON.stringify(["legacy-java", roleId, serverId]);
}

function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("本地挑战历史列表格式无效");
  return value.map(object);
}
function fields(row: Record<string, unknown>, numbers: readonly string[], strings: readonly string[] = []): void {
  if (numbers.some((key) => typeof row[key] !== "number" || !Number.isFinite(row[key])) || strings.some((key) => typeof row[key] !== "string")) throw new Error("本地挑战历史字段格式无效");
}
function teamFields(row: Record<string, unknown>): void {
  if (row["roles"] !== undefined)
    for (const role of rows(row["roles"])) {
      fields(role, [], ["id", "name", "iconUrl"]);
      if (role["skillBranch"] !== null && (typeof role["skillBranch"] !== "number" || !Number.isFinite(role["skillBranch"]))) throw new Error("挑战角色分支无效");
    }
  if (row["buffs"] !== undefined) for (const buff of rows(row["buffs"])) fields(buff, ["quality"], ["id", "name", "description", "iconUrl"]);
  if (row["bossCount"] !== undefined) fields(row, ["bossCount"]);
}

function readSnapshots(value: unknown): ChallengeSnapshot[] {
  if (!Array.isArray(value)) throw new Error("本地挑战历史格式无效");
  for (const item of value) {
    const row = object(item);
    const data = object(row["data"]);
    if (typeof row["id"] !== "string" || typeof row["endTime"] !== "number" || !Number.isSafeInteger(row["endTime"]) || row["endTime"] <= 0 || typeof row["updatedAt"] !== "number" || !Number.isSafeInteger(row["updatedAt"]) || typeof data["unlocked"] !== "boolean") throw new Error("本地挑战历史格式无效");
    if (row["kind"] === "tower") {
      if (typeof data["seasonEndTime"] !== "number" || !Array.isArray(data["areas"])) throw new Error("本地深塔历史格式无效");
      for (const area of rows(data["areas"])) {
        fields(area, ["stars", "maxStars"], ["name"]);
        for (const floor of rows(area["floors"])) {
          fields(floor, ["stars", "roleCount"], ["floor"]);
          teamFields(floor);
        }
      }
    } else if (row["kind"] === "slash") {
      if (typeof data["seasonEndTime"] !== "number" || !Array.isArray(data["difficulties"])) throw new Error("本地海墟历史格式无效");
      for (const difficulty of rows(data["difficulties"])) {
        fields(difficulty, ["score", "maxScore"], ["name"]);
        for (const challenge of rows(difficulty["challenges"])) {
          fields(challenge, ["score"], ["name", "rank"]);
          for (const half of rows(challenge["halves"])) {
            fields(half, ["score", "roleCount"], ["name"]);
            teamFields(half);
          }
        }
      }
    } else if (row["kind"] === "new-tower") {
      if (typeof data["endTime"] !== "number" || !Array.isArray(data["modes"]) || typeof data["reward"] !== "number" || typeof data["totalReward"] !== "number") throw new Error("本地矩阵历史格式无效");
      for (const mode of rows(data["modes"])) {
        fields(mode, ["modeId", "score", "rank", "round", "passBoss", "bossCount"]);
        if (typeof mode["hasRecord"] !== "boolean") throw new Error("本地矩阵记录状态无效");
        for (const team of rows(mode["teams"])) {
          fields(team, ["score", "round", "passBoss", "roleCount"]);
          teamFields(team);
        }
      }
    } else throw new Error("本地挑战历史类型无效");
  }
  return value as ChallengeSnapshot[];
}

export function challengeSnapshots(view: ChallengeView): ChallengeSnapshot[] {
  const result: ChallengeSnapshot[] = [];
  for (const kind of ["tower", "slash", "new-tower"] as const) {
    const data = kind === "tower" ? view.tower : kind === "slash" ? view.slash : view.newTower;
    const deadline = "seasonEndTime" in data ? data.seasonEndTime : data.endTime;
    if (!data.unlocked || deadline <= 0) continue;
    if (!Number.isSafeInteger(deadline) || !Number.isFinite(new Date(deadline).getTime())) throw new Error("挑战周期截止时间无效");
    // 各接口顺序返回导致几秒偏差，按最接近的小时归并同一周期。
    const endTime = Math.round(deadline / millisecondsPerHour) * millisecondsPerHour;
    const base = {
      id: `${kind}:${endTime}`,
      endTime,
      updatedAt: view.updatedAt,
    };
    if (kind === "tower") result.push({ ...base, kind, data: view.tower });
    else if (kind === "slash") result.push({ ...base, kind, data: view.slash });
    else result.push({ ...base, kind, data: view.newTower });
  }
  return result;
}

export class ChallengeHistoryStore {
  #queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path = join(appPaths.dataDirectory, "kujiequ-challenge-history.json")) {}

  async #read(): Promise<Record<string, unknown>> {
    try {
      return object(JSON.parse(await readFile(this.path, "utf8")) as unknown);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
      throw new Error("读取本地挑战历史失败");
    }
  }
  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation);
    this.#queue = result.catch(() => {});
    return result;
  }
  list(key: string): Promise<ChallengeSnapshot[]> {
    return this.#serialize(async () => readSnapshots((await this.#read())[key] ?? []).sort((a, b) => b.endTime - a.endTime));
  }
  importLegacy(incoming: readonly LegacyChallenge[]): Promise<{ addedCount: number; duplicateCount: number }> {
    return this.#serialize(async () => {
      const stored = await this.#read();
      let addedCount = 0;
      for (const { roleId, snapshot } of incoming) {
        if (!/^\d+$/.test(roleId)) throw new Error("旧版挑战玩家 ID 无效");
        readSnapshots([snapshot]);
        const key = legacyChallengeKey(roleId);
        const previous = readSnapshots(stored[key] ?? []);
        if (previous.some((item) => item.id === snapshot.id)) continue;
        stored[key] = [...previous, snapshot].sort((a, b) => b.endTime - a.endTime);
        addedCount++;
      }
      if (addedCount) await this.#write(stored);
      return { addedCount, duplicateCount: incoming.length - addedCount };
    });
  }
  async #write(stored: Record<string, unknown>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${crypto.randomUUID()}.tmp`;
    try {
      await Bun.write(temporary, `${JSON.stringify(stored, null, 2)}\n`);
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  merge(key: string, view: ChallengeView): Promise<void> {
    const incoming = challengeSnapshots(view);
    if (!incoming.length) return Promise.resolve();
    return this.#serialize(async () => {
      const stored = await this.#read();
      const previous = readSnapshots(stored[key] ?? []);
      const records = new Map(previous.map((item) => [item.id, item]));
      for (const item of incoming) if ((records.get(item.id)?.updatedAt ?? -1) <= item.updatedAt) records.set(item.id, item);
      stored[key] = [...records.values()].sort((a, b) => b.endTime - a.endTime);
      await this.#write(stored);
    });
  }
}
export const challengeHistoryStore = new ChallengeHistoryStore();
