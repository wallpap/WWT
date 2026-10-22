import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { appPaths } from "../platform/app-paths.ts";
import { diagnostic } from "../platform/diagnostics.ts";
import { millisecondsPerMinute } from "../units.ts";

const redemptionServiceSuccessCode = 200;
const redemptionCacheLifetimeMs = 5 * millisecondsPerMinute;
const redemptionRequestTimeoutMs = 20_000;

export interface RedemptionCode {
  key: string;
  startTime: string;
  endTime: string;
  description: string;
  reward: string;
  contributors: string;
  valid: boolean;
  sourceUrl: string;
}
export interface RedemptionCodes {
  codes: RedemptionCode[];
  updatedAt: number;
  cached?: boolean;
  notice?: string;
}
export const redemptionCodesUrl = "https://gamecal.nv5.me/api/events/ww";

function requestFailure(error: unknown): { reason: string; stage: string } {
  const row =
    typeof error === "object" && error !== null
      ? (error as {
          code?: unknown;
          name?: unknown;
          cause?: { code?: unknown };
        })
      : {};
  const code = row.code ?? row.cause?.code;
  if (code === "ERR_TLS_CERT_ALTNAME_INVALID") return { reason: "兑换码服务证书与域名不匹配", stage: "tls-hostname" };
  if (typeof code === "string" && /CERT|TLS|SSL/.test(code)) return { reason: "兑换码服务证书验证失败", stage: "tls" };
  if (row.name === "TimeoutError" || row.name === "AbortError") return { reason: "兑换码服务请求超时", stage: "timeout" };
  return { reason: "兑换码服务网络请求失败", stage: "network" };
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("兑换码数据格式无效");
  return value as Record<string, unknown>;
}
function parseCodes(value: unknown): RedemptionCode[] {
  if (!Array.isArray(value)) throw new Error("兑换码列表格式无效");
  const codes = value.map((item) => {
    const row = object(item);
    if (typeof row["key"] !== "string" || !row["key"].trim() || typeof row["valid"] !== "boolean") throw new Error("兑换码条目无效");
    const text = (key: string): string => (typeof row[key] === "string" ? row[key] : "");
    return {
      key: row["key"].trim(),
      startTime: text("startTime"),
      endTime: text("endTime"),
      description: text("description"),
      reward: text("reward"),
      contributors: text("contributors"),
      valid: row["valid"],
      sourceUrl: text("sourceUrl"),
    };
  });
  return [...new Map(codes.map((code) => [code.key, code])).values()].sort((a, b) => Number(b.valid) - Number(a.valid));
}
export function parseRedemptionCodes(value: unknown, updatedAt = Date.now()): RedemptionCodes {
  const row = object(value);
  if (row["code"] !== redemptionServiceSuccessCode) throw new Error("兑换码服务暂不可用");
  if (!Array.isArray(row["data"])) throw new Error("兑换码活动列表格式无效");
  const codes: RedemptionCode[] = [];
  for (const value of row["data"]) {
    const event = object(value);
    if (event["redeem_codes"] == null) continue;
    if (!Array.isArray(event["redeem_codes"])) throw new Error("兑换码条目无效");
    const endTime = typeof event["end_time"] === "string" ? event["end_time"] : "";
    const end = Date.parse(endTime);
    if (!event["redeem_codes"].length) continue;
    if (!Number.isFinite(end)) throw new Error("兑换码截止时间无效");
    for (const key of event["redeem_codes"]) {
      if (typeof key !== "string" || !key.trim()) throw new Error("兑换码条目无效");
      codes.push({
        key: key.trim(),
        startTime: typeof event["start_time"] === "string" ? event["start_time"] : "",
        endTime,
        description: typeof event["title"] === "string" ? event["title"] : "",
        reward: "",
        contributors: "game-cal · 鸣潮官方公告",
        sourceUrl: typeof event["linkUrl"] === "string" ? event["linkUrl"] : "",
        valid: end > updatedAt,
      });
    }
  }
  return { codes: parseCodes(codes), updatedAt };
}

export class RedemptionCodeService {
  #pending: Promise<RedemptionCodes> | null = null;
  #memory: RedemptionCodes | null = null;
  constructor(
    private readonly path = join(appPaths.dataDirectory, "redemption-codes.json"),
    private readonly fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch,
  ) {}
  async local(): Promise<RedemptionCodes> {
    const row = object(JSON.parse(await readFile(this.path, "utf8")) as unknown);
    if (row["source"] !== redemptionCodesUrl) throw new Error("兑换码缓存来源已变化，请刷新列表");
    if (typeof row["updatedAt"] !== "number" || !Number.isSafeInteger(row["updatedAt"]) || row["updatedAt"] < 0) throw new Error("兑换码缓存时间无效");
    return {
      codes: parseCodes(row["codes"]).map((code) => ({ ...code, valid: Date.parse(code.endTime) > Date.now() })),
      updatedAt: row["updatedAt"],
      cached: true,
    };
  }
  async load(force = false): Promise<RedemptionCodes> {
    if (!force && this.#memory && Date.now() - this.#memory.updatedAt < redemptionCacheLifetimeMs) return { ...this.#memory, codes: this.#memory.codes.map((code) => ({ ...code, valid: Date.parse(code.endTime) > Date.now() })) };
    if (this.#pending) return this.#pending;
    this.#pending = this.#load();
    try {
      return await this.#pending;
    } finally {
      this.#pending = null;
    }
  }
  async #load(): Promise<RedemptionCodes> {
    let next: RedemptionCodes;
    let stage = "request";
    let status: number | undefined;
    const started = performance.now();
    try {
      const options: RequestInit = {
        signal: AbortSignal.timeout(redemptionRequestTimeoutMs),
        redirect: "error",
        credentials: "omit",
        headers: { "User-Agent": "Mozilla/5.0 WWT", Accept: "application/json" },
      };
      const response = await this.fetcher(redemptionCodesUrl, options);
      status = response.status;
      stage = "http";
      if (!response.ok) throw new Error("兑换码服务请求失败");
      stage = "parse";
      next = parseRedemptionCodes(await response.json());
    } catch (error) {
      const failure =
        stage === "request"
          ? requestFailure(error)
          : {
              reason: stage === "http" ? `兑换码服务返回 HTTP ${status}` : "兑换码服务响应格式无效",
              stage,
            };
      diagnostic("redemption.request.failed", {
        stage: failure.stage,
        ...(status === undefined ? {} : { status }),
        elapsedMs: Math.round(performance.now() - started),
      });
      try {
        return {
          ...(await this.local()),
          notice: `${failure.reason}，已显示本地缓存，请留意有效期`,
        };
      } catch {
        throw new Error(`${failure.reason}，当前没有可用的本地缓存`);
      }
    }
    this.#memory = next;
    const temporary = `${this.path}.${crypto.randomUUID()}.tmp`;
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await Bun.write(temporary, `${JSON.stringify({ ...next, source: redemptionCodesUrl }, null, 2)}\n`);
      await rename(temporary, this.path);
    } catch {
      return { ...next, notice: "兑换码已获取，本地缓存未能保存" };
    } finally {
      await rm(temporary, { force: true });
    }
    return next;
  }
}
