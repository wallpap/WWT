import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseRedemptionCodes, RedemptionCodeService } from "../../src/app/redemption-codes.ts";

const payload = {
  code: 200,
  data: [
    { title: "已过期前瞻", redeem_codes: ["EXPIRED"], end_time: "2020-01-01T00:00:00+08:00" },
    { title: "前瞻奖励", redeem_codes: ["CURRENT", "CURRENT"], end_time: "2099-01-01T00:00:00+08:00", linkUrl: "https://www.kurobbs.com/mc/post/fixture", token: "discard-sensitive-field" },
    { title: "普通活动" },
  ],
};
test("game-cal codes are extracted from events, deduplicated and evaluated by deadline", () => {
  const now = Date.parse("2026-10-22T00:00:00+08:00");
  const result = parseRedemptionCodes(payload, now);
  expect(result.codes.map((code) => code.key)).toEqual(["CURRENT", "EXPIRED"]);
  expect(result.codes.map((code) => code.valid)).toEqual([true, false]);
  expect(result.updatedAt).toBe(now);
  expect(() => parseRedemptionCodes({ code: 401 })).toThrow("服务暂不可用");
  expect(() => parseRedemptionCodes({ code: 200, data: [{ redeem_codes: [null], end_time: "2099-01-01" }] })).toThrow("条目无效");
});

test("concurrent loads share one request and a restart can read the projected offline cache without replacing it on failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-codes-"));
  try {
    const path = join(root, "codes.json");
    let calls = 0;
    const service = new RedemptionCodeService(path, async () => {
      calls++;
      await Bun.sleep(1);
      return Response.json(payload);
    });
    await Promise.all([service.load(true), service.load(true)]);
    expect(calls).toBe(1);
    await service.load();
    expect(calls).toBe(1);
    const stored = await readFile(path, "utf8");
    expect(stored).not.toContain("discard-sensitive-field");
    const reopened = new RedemptionCodeService(path, async () => {
      throw new Error("offline");
    });
    expect((await reopened.load(true)).cached).toBe(true);
    expect((await reopened.local()).codes[0]!.key).toBe("CURRENT");
    expect(await readFile(path, "utf8")).toBe(stored);
    const missing = new RedemptionCodeService(join(root, "missing.json"), async () => new Response("", { status: 503 }));
    await expect(missing.load()).rejects.toThrow("没有可用的本地缓存");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TLS hostname failure is explained and preserves the last usable cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-codes-tls-"));
  try {
    const path = join(root, "codes.json");
    const fail = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      throw Object.assign(new Error("untrusted diagnostic text"), {
        code: "ERR_TLS_CERT_ALTNAME_INVALID",
      });
    };
    await expect(new RedemptionCodeService(path, fail).load()).rejects.toThrow("证书与域名不匹配");
    await new RedemptionCodeService(path, async () => Response.json(payload)).load();
    const stored = await readFile(path, "utf8");
    const cached = await new RedemptionCodeService(path, fail).load();
    expect(cached.cached).toBe(true);
    expect(cached.notice).toContain("证书与域名不匹配");
    expect(cached.notice).not.toContain("untrusted diagnostic text");
    expect(await readFile(path, "utf8")).toBe(stored);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("game-cal requests verify certificates and identify the JSON client", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-gamecal-"));
  try {
    const service = new RedemptionCodeService(join(root, "codes.json"), async (url, options) => {
      expect(String(url)).toBe("https://gamecal.nv5.me/api/events/ww");
      expect(options?.redirect).toBe("error");
      expect(options?.credentials).toBe("omit");
      expect(new Headers(options?.headers).get("User-Agent")).toContain("Mozilla/5.0");
      return Response.json(payload);
    });
    expect((await service.load()).codes[0]?.key).toBe("CURRENT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
