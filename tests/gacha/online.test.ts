import { expect, test } from "bun:test";
import { OnlineGachaClient, parseGachaLink } from "../../src/gacha/online.ts";
import { decryptGachaLog, extractGachaLink } from "../../src/gacha/log.ts";

const link = "https://example.invalid/aki/gacha/index.html#/record?player_id=10001&record_id=fixture%3Dcredential&resources_id=1&gacha_type=1&svr_id=cn&lang=zh-Hans";
const card = {
  cardPoolType: "角色活动",
  resourceId: 1,
  qualityLevel: 5,
  resourceType: "角色",
  name: "测试",
  count: 1,
  time: "2026-10-19 12:00:00",
};

test("parses escaped links and rejects duplicate and missing fields without echoing credentials", () => {
  expect(parseGachaLink(link.replaceAll("&", "&amp;"))["recordId"]).toBe("fixture=credential");
  expect(() => parseGachaLink(`${link}&record_id=secret`)).toThrow("重复参数");
  expect(() => parseGachaLink(link.replace("player_id=10001&", ""))).toThrow("缺少必要参数");
  expect(() => parseGachaLink("secret")).toThrow("完整的游戏抽卡记录");
});

test("queries thirteen pools in order at fixed endpoints, normalizes records and reports progress", async () => {
  const requests: { url: string; pool: string }[] = [];
  const progress: number[] = [];
  const client = new OnlineGachaClient(async (url, options) => {
    expect(options?.redirect).toBe("error");
    const body = JSON.parse(String(options?.body));
    requests.push({ url: String(url), pool: body.cardPoolType });
    return Response.json({
      code: 0,
      data: body.cardPoolType === "1" ? [card] : [],
    });
  }, 0);
  const records = await client.queryAll(link, (p) => progress.push(p.completedPools));
  expect(requests.map((r) => r.pool)).toEqual(Array.from({ length: 13 }, (_, i) => String(i + 1)));
  expect(requests.every((r) => r.url === "https://gmserver-api.aki-game2.com/gacha/record/query")).toBe(true);
  expect(records[0]).toMatchObject({
    playerId: "10001",
    gachaName: "角色活动唤取",
    name: "测试",
  });
  expect(progress).toEqual(Array.from({ length: 14 }, (_, i) => i));
  requests.length = 0;
  await expect(client.queryAll(link.replace("10001", "90001"))).rejects.toThrow("国服抽卡记录链接");
  expect(requests).toHaveLength(0);
});

test("stops on failed pool, suppresses server messages and releases busy state", async () => {
  let calls = 0;
  const client = new OnlineGachaClient(async () => {
    calls++;
    return Response.json(calls === 1 ? { code: 0, data: [card] } : { code: 1, message: "fixture=credential" });
  }, 0);
  await expect(client.queryAll(link)).rejects.toThrow("官方接口拒绝");
  expect(calls).toBe(2);
  await expect(client.queryAll(link)).rejects.toThrow("官方接口拒绝");
});

test("rejects overlapping requests and malformed successful responses", async () => {
  let finish!: (value: Response) => void;
  const client = new OnlineGachaClient(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    0,
  );
  const pending = client.queryAll(link);
  await expect(client.queryAll(link)).rejects.toThrow("正在查询");
  await Bun.sleep(5);
  finish(Response.json({ code: 0, data: null }));
  await expect(pending).rejects.toThrow("数据格式无效");
});

test("decrypts Client.log and extracts the latest validated link", () => {
  const valid = "https://gmserver-api.aki-game2.com/aki/gacha/index.html#/record?player_id=100000001&record_id=abc&resources_id=1&gacha_type=1&svr_id=cn&lang=zh-cn";
  const encrypt = (value: number): number => {
    for (let candidate = 0; candidate < 256; candidate += 1) {
      const decoded = (candidate & 0x0f) % 2 === 1 ? candidate ^ 0xa5 : candidate ^ 0xef;
      if (decoded === value) return candidate;
    }
    throw new Error("夹具无法构造日志字节");
  };
  const validEncrypted = Uint8Array.from(new TextEncoder().encode(valid), encrypt);
  expect(extractGachaLink(decryptGachaLog(validEncrypted))).toBe(valid);
});
