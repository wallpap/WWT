import { millisecondsPerSecond } from "../units.ts";

const updateRequestTimeoutMs = 20 * millisecondsPerSecond;
const sha256DigestPattern = /^sha256:[a-f\d]{64}$/i;
const sha256PrefixLength = "sha256:".length;

export interface AppReleaseAsset {
  name: string;
  url: string;
  size: number;
  sha256: string;
}
export interface AppRelease {
  version: string;
  publishedAt: string;
  notes: string;
  asset: AppReleaseAsset;
}
export function normalizeUpdateSource(value: string): string {
  const source = value.trim();
  if (!source) return "";
  if (/^[\w.-]+\/[\w.-]+$/.test(source)) return source.replace(/\.git$/, "");
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error("更新源需填写 GitHub owner/repo 或 HTTPS 清单地址");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("更新源需使用不含凭据或查询参数的 HTTPS 地址");
  if (url.hostname === "github.com" && /^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname)) return url.pathname.replace(/^\/|\/$/g, "").replace(/\.git$/, "");
  return url.toString();
}
function versionParts(value: string): { core: bigint[]; prerelease: string[] } {
  const match = /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>[\da-z-]+(?:\.[\da-z-]+)*))?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$/i.exec(value);
  if (!match?.groups) throw new Error("应用版本号无效");
  const { major, minor, patch, prerelease } = match.groups;
  if (prerelease?.split(".").some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) throw new Error("应用版本号无效");
  return {
    core: [BigInt(major!), BigInt(minor!), BigInt(patch!)],
    prerelease: prerelease?.split(".") ?? [],
  };
}
export function compareAppVersions(left: string, right: string): number {
  const a = versionParts(left),
    b = versionParts(right);
  for (let index = 0; index < a.core.length; index++) if (a.core[index] !== b.core[index]) return a.core[index]! > b.core[index]! ? 1 : -1;
  if (!a.prerelease.length || !b.prerelease.length) return a.prerelease.length ? -1 : b.prerelease.length ? 1 : 0;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const x = a.prerelease[index],
      y = b.prerelease[index];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (/^\d+$/.test(x) !== /^\d+$/.test(y)) return /^\d+$/.test(x) ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("应用更新清单格式无效");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
export function parseAppRelease(value: unknown, feedUrl: string): AppRelease {
  const row = object(value);
  if (row["app"] !== "wwt-bun") throw new Error("更新清单与 Bun 重写版不匹配");
  const version = string(row["version"]);
  versionParts(version);
  const asset = object(row["asset"]),
    name = string(asset["name"]);
  if (name !== `WWT-${version}-windows-x64.zip`) throw new Error("更新包名称与目标版本不匹配");
  if (!string(asset["url"])) throw new Error("更新包地址无效");
  const url = new URL(string(asset["url"]), feedUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("更新包地址无效");
  if (typeof asset["size"] !== "number" || !Number.isSafeInteger(asset["size"]) || asset["size"] <= 0 || typeof asset["sha256"] !== "string" || !/^[a-f\d]{64}$/i.test(asset["sha256"])) throw new Error("更新包大小或 SHA-256 校验值无效");
  return {
    version,
    publishedAt: string(row["publishedAt"]),
    notes: string(row["notes"]),
    asset: {
      name,
      url: url.toString(),
      size: asset["size"],
      sha256: asset["sha256"].toLowerCase(),
    },
  };
}
export async function fetchAppRelease(source: string, fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch): Promise<AppRelease> {
  const normalized = normalizeUpdateSource(source);
  if (!normalized) throw new Error("请先填写本项目的应用更新源");
  const github = !normalized.startsWith("https://");
  const url = github ? `https://api.github.com/repos/${normalized}/releases/latest` : normalized;
  const response = await fetcher(url, {
    redirect: "error",
    signal: AbortSignal.timeout(updateRequestTimeoutMs),
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`应用更新查询失败（HTTP ${response.status}）`);
  const value: unknown = await response.json();
  if (!github) return parseAppRelease(value, url);
  const release = object(value),
    version = string(release["tag_name"]).replace(/^v/, "");
  versionParts(version);
  if (release["draft"] === true || release["prerelease"] === true || !Array.isArray(release["assets"])) throw new Error("GitHub 发布版本不可用");
  const asset = (release["assets"] as unknown[]).map(object).find((item) => item["name"] === `WWT-${version}-windows-x64.zip`);
  if (!asset) throw new Error("该发布没有 Bun 重写版的 Windows x64 便携包");
  const digest = string(asset["digest"]);
  if (!sha256DigestPattern.test(digest)) throw new Error("发布资产缺少 SHA-256 校验值，请使用带校验值的更新清单");
  return parseAppRelease(
    {
      app: "wwt-bun",
      version,
      notes: release["body"],
      publishedAt: release["published_at"],
      asset: {
        name: asset["name"],
        url: asset["browser_download_url"],
        size: asset["size"],
        sha256: digest.slice(sha256PrefixLength),
      },
    },
    url,
  );
}
