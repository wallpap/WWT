import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { WindowBridge } from "../../src/platform/window-bridge.ts";

function openPage(bridge: WindowBridge) {
  let endpoint = "";
  let headers = new Headers();
  const page: Record<string, unknown> = { addEventListener() {} };
  page["top"] = page;
  runInNewContext(bridge.bootstrapScript(), {
    window: page,
    location: { protocol: "file:", href: "file:///test.html" },
    crypto, Uint32Array, TextDecoder, AbortController, queueMicrotask, setTimeout,
    fetch(url: string, options: RequestInit) {
      endpoint = new URL(url).origin;
      headers = new Headers(options.headers);
      headers.set("origin", "null");
      return fetch(url, { ...options, headers });
    },
  });
  return {
    endpoint,
    get headers() { return new Headers(headers); },
    call(name: string, ...args: unknown[]): Promise<unknown> {
      return (page[name] as (...parameters: unknown[]) => Promise<unknown>)(...args);
    },
  };
}

test("window bridge validates source, host, token, document and request shape", async () => {
  const bridge = new WindowBridge();
  bridge.bind("ping", () => "pong");
  try {
    const page = openPage(bridge);
    expect(await page.call("ping")).toBe("pong");
    for (const [name, value] of [["origin", "https://example.com"], ["host", "example.com"], ["x-wwt-token", "invalid"]]) {
      const headers = page.headers;
      headers.set(name!, value!);
      const response = await fetch(`${page.endpoint}/rpc`, { method: "POST", headers, body: "[]" });
      expect(response.status).toBe(403);
    }
    const missingToken = page.headers;
    missingToken.delete("x-wwt-token");
    expect((await fetch(`${page.endpoint}/events`, { headers: missingToken })).status).toBe(403);
    const otherDocument = page.headers;
    otherDocument.set("x-wwt-document", "0".repeat(32));
    expect((await fetch(`${page.endpoint}/rpc`, { method: "POST", headers: otherDocument, body: "[]" })).status).toBe(409);
    expect((await fetch(`${page.endpoint}/rpc`, { headers: page.headers })).status).toBe(405);
    expect((await fetch(`${page.endpoint}/rpc`, { method: "POST", headers: page.headers, body: "[{}]" })).status).toBe(400);
    expect((await fetch(`${page.endpoint}/rpc`, { method: "POST", headers: page.headers, body: "invalid" })).status).toBe(400);
  } finally {
    bridge.close();
  }
});

test("window bridge returns each batched call independently and preserves error objects", async () => {
  const bridge = new WindowBridge();
  let finish: (value: string) => void = () => {};
  const slow = new Promise<string>((resolve) => { finish = resolve; });
  bridge.bind("slow", () => slow);
  bridge.bind("fast", (value: string) => value);
  bridge.bind("fail", () => { throw new Error("sync-failure"); });
  bridge.bind("asyncFail", async () => { throw new Error("async-failure"); });
  bridge.bind("invalidResult", () => 1n);
  try {
    const page = openPage(bridge);
    const longCall = page.call("slow");
    const fastCall = page.call("fast", "ready");
    const syncError = page.call("fail").catch((error: unknown) => error);
    const asyncError = page.call("asyncFail").catch((error: unknown) => error);
    const serializationError = page.call("invalidResult").catch((error: unknown) => error);
    expect(await fastCall).toBe("ready");
    expect(await syncError).toEqual({ message: "sync-failure" });
    expect(await asyncError).toEqual({ message: "async-failure" });
    expect(await serializationError).toHaveProperty("message");
    finish("finished");
    expect(await longCall).toBe("finished");
  } finally {
    finish("finished");
    bridge.close();
  }
});

test("window bridge closes pending calls and isolates replies across page reloads", async () => {
  const bridge = new WindowBridge();
  let finish: (value: string) => void = () => {};
  bridge.bind("slow", () => new Promise<string>((resolve) => { finish = resolve; }));
  bridge.bind("ping", () => "pong");
  try {
    const first = openPage(bridge);
    expect(await first.call("ping")).toBe("pong");
    const abandoned = first.call("slow").catch((error: unknown) => error);
    // ping 与 slow 同批抵达，确保切换文档时旧请求已经开始。
    await first.call("ping");
    const second = openPage(bridge);
    expect(await second.call("ping")).toBe("pong");
    expect(await abandoned).toHaveProperty("message");
    finish("old-document-result");
    expect(await second.call("ping")).toBe("pong");
    const pending = second.call("slow").catch((error: unknown) => error);
    await second.call("ping");
    bridge.close();
    expect(await pending).toHaveProperty("message");
    expect(await second.call("ping").catch((error: unknown) => error)).toHaveProperty("message");
  } finally {
    finish("finished");
    bridge.close();
  }
});
