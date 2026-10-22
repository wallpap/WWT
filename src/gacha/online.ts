import { parseGachaImport } from "./import.ts";
import type { GachaRecord } from "./model.ts";
import { gachaPoolCode, gachaPoolCodePattern, gachaPoolNames as pools } from "./pools.ts";
import { gachaApiSuccessCode } from "./constants.ts";
import { millisecondsPerSecond } from "../units.ts";

const onlineGachaRequestIntervalMs = 2 * millisecondsPerSecond;
const onlineGachaRequestTimeoutMs = 30 * millisecondsPerSecond;

export function parseGachaLink(input: string): Record<string, string> {
  const invalid = () => new Error("请粘贴完整的游戏抽卡记录 HTTPS 链接");
  let url: URL;
  try {
    url = new URL(input.trim().replaceAll("\\u0026", "&").replaceAll("&amp;", "&"));
  } catch {
    throw invalid();
  }
  const [route, ...query] = url.hash.slice(1).split("?");
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/aki/gacha/index.html" || route !== "/record") throw invalid();
  const names: Record<string, string> = {
    player_id: "playerId",
    record_id: "recordId",
    resources_id: "cardPoolId",
    gacha_type: "cardPoolType",
    svr_id: "serverId",
    lang: "languageCode",
  };
  const fields: Record<string, string> = {};
  for (const params of [url.searchParams, new URLSearchParams(query.join("?"))]) {
    for (const [key, value] of params) {
      const name = Object.hasOwn(names, key) ? names[key] : undefined;
      if (!name) continue;
      if (!value.trim() || Object.hasOwn(fields, name)) throw new Error("抽卡链接包含空值或重复参数，请重新复制");
      fields[name] = value;
    }
  }
  if (Object.values(names).some((name) => !fields[name])) throw new Error("抽卡链接缺少必要参数，请重新复制完整链接");
  if (!/^\d+$/.test(fields["playerId"]!) || !gachaPoolCodePattern.test(fields["cardPoolType"]!)) throw invalid();
  if (!fields["playerId"]!.startsWith("1")) throw new Error("请使用国服抽卡记录链接");
  return fields;
}

export interface GachaProgress {
  completedPools: number;
  totalPools: number;
}

export class OnlineGachaClient {
  #busy = false;
  #nextRequest = 0;

  constructor(
    private readonly request: (url: string, options: RequestInit) => Promise<Response> = fetch,
    private readonly interval = onlineGachaRequestIntervalMs,
  ) {}

  async queryAll(link: string, onProgress?: (progress: GachaProgress) => void): Promise<GachaRecord[]> {
    if (this.#busy) throw new Error("正在查询抽卡记录，请等待完成");
    const params = parseGachaLink(link);
    const endpoint = "https://gmserver-api.aki-game2.com/gacha/record/query";
    this.#busy = true;
    try {
      const records: GachaRecord[] = [];
      onProgress?.({ completedPools: 0, totalPools: pools.length });
      for (const [index, name] of pools.entries()) {
        await Bun.sleep(Math.max(0, this.#nextRequest - performance.now()));
        this.#nextRequest = performance.now() + this.interval;
        let value: unknown;
        try {
          const response = await this.request(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...params,
            cardPoolType: String(index + gachaPoolCode.characterEvent),
            }),
            redirect: "error",
            signal: AbortSignal.timeout(onlineGachaRequestTimeoutMs),
          });
          if (!response.ok) throw new Error();
          value = await response.json();
        } catch {
          // 网络异常可能携带含凭据的请求信息，界面使用固定消息。
          throw new Error(`查询${name}失败，请检查网络或重新获取抽卡链接`);
        }
        if (typeof value !== "object" || value === null || !("code" in value) || value.code !== gachaApiSuccessCode) {
          throw new Error(`官方接口拒绝查询${name}，请重新获取抽卡链接`);
        }
        if (!("data" in value) || !Array.isArray(value.data)) throw new Error(`官方接口返回的${name}数据格式无效`);
        try {
          if (value.data.length) {
            const normalized = parseGachaImport(JSON.stringify({ [name]: value.data }), params["playerId"]);
            records.push(
              ...normalized.map((record) => ({
                ...record,
                playerId: params["playerId"]!,
                gachaName: name,
              })),
            );
          }
        } catch {
          throw new Error(`官方接口返回的${name}记录格式无效`);
        }
        onProgress?.({ completedPools: index + 1, totalPools: pools.length });
      }
      return records;
    } finally {
      this.#busy = false;
    }
  }
}
