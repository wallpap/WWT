import { normalizeResourcePath, validateResourcePaths } from "./resource-path.ts";
import { createHash } from "node:crypto";
import { millisecondsPerMinute } from "../units.ts";
import { parseOfficialPatch, sameResourceVersion, type OfficialResourcePatch } from "./official-patch.ts";

export type OfficialResourceSource = "mainland" | "bilibili";
export type ResourceFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface OfficialResourceFile {
  path: string;
  size: number;
  md5: string | null;
  url: string;
}

export interface OfficialResourceManifest {
  source: OfficialResourceSource;
  version: string;
  files: OfficialResourceFile[];
  totalBytes: number;
  predownload: boolean;
  patch?: OfficialResourcePatch;
  patchNotice?: string;
}

interface ResourceUpdateConfig {
  cdnList?: unknown;
  config?: unknown;
  resources?: unknown;
  resourcesBasePath?: unknown;
}

const channelConfigUrls: Record<OfficialResourceSource, readonly [string, string]> = {
  mainland: ["https://prod-cn-alicdn-gamestarter.kurogame.com/launcher/game/G152/10003_Y8xXrXk65DqFHEDgApn3cpK5lfczpFx5/index.json", "https://prod-volcdn-gamestarter.kurogame.xyz/launcher/game/G152/10003_Y8xXrXk65DqFHEDgApn3cpK5lfczpFx5/index.json"],
  bilibili: ["https://prod-cn-alicdn-gamestarter.kurogame.com/launcher/game/G152/10004_j5GWFuUFlb8N31Wi2uS3ZAVHcb7ZGN7y/index.json", "https://prod-volcdn-gamestarter.kurogame.xyz/launcher/game/G152/10004_j5GWFuUFlb8N31Wi2uS3ZAVHcb7ZGN7y/index.json"],
};

export function officialResourceConfigUrls(source: OfficialResourceSource): readonly [string, string] {
  const urls = channelConfigUrls[source];
  if (!urls) throw new Error("游戏渠道无效");
  return urls;
}

function objectValue(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`官方资源配置缺少${field}`);
  return value.trim();
}

function configNode(value: unknown, predownload: boolean): ResourceUpdateConfig {
  const root = objectValue(value, "官方资源配置格式无效");
  if (predownload && root["predownload"] == null) throw new Error("官方当前没有开放预下载资源");
  const selected = root[predownload ? "predownload" : "default"] ?? root;
  return objectValue(selected, "官方更新配置格式无效") as ResourceUpdateConfig;
}

function appendUrl(base: string, path: string): string {
  const url = new URL(base);
  const cleanPath = path.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (!cleanPath || cleanPath.split("/").some((part) => part === ".." || part === ".")) throw new Error(`官方资源路径不安全：${path}`);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${cleanPath}`;
  return url.toString();
}

function parseUpdateConfig(
  value: unknown,
  predownload: boolean,
): {
  config: ResourceUpdateConfig;
  version: string;
  cdns: string[];
  resourcePath: string;
  basePath: string;
  indexFile: string;
  indexMd5: string;
} {
  const config = configNode(value, predownload);
  const configValue = objectValue(config.config, "官方资源配置缺少 config 节点");
  const version = requiredString(configValue["version"], "版本号");
  const indexFile = requiredString(configValue["indexFile"], "索引文件");
  const resourcePath = requiredString(config.resources, "资源索引地址");
  const cdnValues = config.cdnList;
  if (!Array.isArray(cdnValues)) throw new Error("官方资源配置缺少 CDN 地址");
  const cdns = cdnValues.map((item) => {
    const cdn = objectValue(item, "官方 CDN 配置无效");
    return requiredString(cdn["url"], "CDN 地址").replace(/\/$/, "");
  });
  if (cdns.length === 0) throw new Error("官方资源配置没有可用 CDN");
  const indexMd5 = typeof configValue["indexFileMd5"] === "string" ? configValue["indexFileMd5"].trim() : "";
  const basePath = typeof config.resourcesBasePath === "string" ? config.resourcesBasePath : "";
  return { config, version, cdns, resourcePath, basePath, indexFile, indexMd5 };
}

function parseFiles(value: unknown, cdn: string, basePath: string, allowEmpty = false): OfficialResourceFile[] {
  const root = objectValue(value, "官方资源索引格式无效");
  const source = root["resource"];
  if (!Array.isArray(source) || (!allowEmpty && source.length === 0)) throw new Error("官方资源索引为空");
  const files = source.map((item) => {
    const file = objectValue(item, "官方资源条目无效");
    const path = normalizeResourcePath(requiredString(file["dest"], "资源路径"));
    const size = file["size"];
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) throw new Error(`官方资源大小无效：${path}`);
    const md5Value = file["md5"];
    if (md5Value !== undefined && md5Value !== "" && (typeof md5Value !== "string" || !/^[a-f\d]{32}$/i.test(md5Value))) throw new Error(`官方资源 MD5 无效：${path}`);
    const folder = typeof file["fromFolder"] === "string" ? file["fromFolder"] : basePath;
    return {
      path,
      size,
      md5: typeof md5Value === "string" && md5Value ? md5Value.toLowerCase() : null,
      url: appendUrl(folder ? appendUrl(cdn, folder) : cdn, path),
    };
  });
  validateResourcePaths(files.map((file) => file.path));
  return files;
}

async function fetchJson(url: string, fetcher: ResourceFetcher, md5 = ""): Promise<unknown> {
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(millisecondsPerMinute),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`官方资源请求失败：HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (md5 && (!/^[a-f\d]{32}$/i.test(md5) || createHash("md5").update(bytes).digest("hex") !== md5.toLowerCase())) throw new Error("官方索引 MD5 校验失败");
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

export async function fetchOfficialResourceManifest(source: OfficialResourceSource, predownload = false, fetcher: ResourceFetcher = fetch, fromVersion?: string | null): Promise<OfficialResourceManifest> {
  let lastError: unknown = null;
  for (const configUrl of officialResourceConfigUrls(source)) {
    try {
      const update = parseUpdateConfig(await fetchJson(configUrl, fetcher), predownload);
      for (const cdn of update.cdns) {
        try {
          const index = await fetchJson(appendUrl(cdn, update.resourcePath), fetcher);
          const files = parseFiles(index, cdn, update.basePath);
          const manifest: OfficialResourceManifest = {
            source,
            version: update.version,
            files,
            totalBytes: files.reduce((total, file) => total + file.size, 0),
            predownload,
          };
          if (fromVersion && !sameResourceVersion(fromVersion, update.version)) {
            const patches = objectValue(update.config.config, "官方更新配置无效")["patchConfig"];
            const patch = Array.isArray(patches) ? (patches.findLast((item) => typeof item === "object" && item !== null && typeof item.version === "string" && sameResourceVersion(item.version, fromVersion)) as Record<string, unknown> | undefined) : undefined;
            if (patch) {
              try {
                const md5 = requiredString(patch["indexFileMd5"], "差分索引校验值");
                const index = await fetchJson(appendUrl(cdn, requiredString(patch["indexFile"], "差分索引")), fetcher, md5);
                const base = requiredString(patch["baseUrl"], "差分下载目录");
                const folder = typeof patch["folder"] === "string" ? patch["folder"].replace(/^\/+|\/+$/g, "") : "";
                manifest.patch = parseOfficialPatch(index, fromVersion, parseFiles(index, cdn, folder ? `${base.replace(/\/$/, "")}/${folder}` : base, true), files);
              } catch {
                manifest.patchNotice = "差分索引不可用，已改用完整文件更新";
              }
            }
          }
          return manifest;
        } catch (error) {
          lastError = error;
        }
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`官方资源索引查询失败：${lastError instanceof Error ? lastError.message : "无可用节点"}`);
}
