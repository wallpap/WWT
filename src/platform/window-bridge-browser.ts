export interface WindowBridgeConfiguration {
  endpoint: string;
  token: string;
  names: string[];
}

// 此函数通过 webview_init 注入页面，所有运行时依赖必须保留在函数内部。
export function installWindowBridge(configuration: WindowBridgeConfiguration): void {
  if (window.top !== window || (location.protocol !== "file:" && location.href !== "about:blank")) return;
  type BridgeWindow = Window & { __wwtWindowBridge?: { bind(names: string[]): void } };
  const target = window as BridgeWindow;
  if (target.__wwtWindowBridge) {
    target.__wwtWindowBridge.bind(configuration.names);
    return;
  }

  type Call = { id: string; args: unknown[] };
  type Pending = { resolve(value: unknown): void; reject(reason: { message: string }): void };
  const pending = new Map<string, Pending>();
  const documentId = Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, "0")).join("");
  const headers = { "content-type": "application/json", "x-wwt-token": configuration.token, "x-wwt-document": documentId };
  const controller = new AbortController();
  let calls: Call[] = [];
  let sequence = 0;
  let scheduled = false;
  let disconnected = false;

  const disconnect = () => {
    disconnected = true;
    for (const call of pending.values()) call.reject({ message: "窗口通信已中断，请重新启动助手" });
    pending.clear();
    calls = [];
    controller.abort();
  };

  const consume = async (body: ReadableStream<Uint8Array>) => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const part = await reader.read();
      if (part.done) throw new Error("窗口通信已中断");
      buffer += decoder.decode(part.value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (!line) continue;
        const event = JSON.parse(line) as { script?: string; id: string; status: number; value: unknown };
        if (typeof event.script === "string") {
          try {
            (0, eval)(event.script);
          } catch (error) {
            setTimeout(() => { throw error; }, 0);
          }
        } else {
          const call = pending.get(event.id);
          pending.delete(event.id);
          if (call) {
            if (event.status === 0) call.resolve(event.value);
            else call.reject(event.value as { message: string });
          }
        }
      }
    }
  };

  const ready = (async () => {
    const response = await fetch(`${configuration.endpoint}/events`, { headers, signal: controller.signal });
    if (!response.ok || !response.body) throw new Error("无法建立窗口通信");
    void consume(response.body).catch(disconnect);
  })();
  void ready.catch(disconnect);

  const flush = async () => {
    scheduled = false;
    const batch = calls;
    calls = [];
    try {
      await ready;
      if (disconnected) return;
      const response = await fetch(`${configuration.endpoint}/rpc`, {
        method: "POST", headers, body: JSON.stringify(batch), signal: controller.signal,
      });
      if (!response.ok) throw new Error(`窗口请求失败（HTTP ${response.status}）`);
    } catch (error) {
      const reason = { message: error instanceof Error ? error.message : String(error) };
      for (const call of batch) {
        pending.get(call.id)?.reject(reason);
        pending.delete(call.id);
      }
    }
  };

  const bridge = {
    bind(names: string[]) {
      for (const name of names) {
        (target as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => new Promise((resolve, reject) => {
          if (disconnected) {
            reject({ message: "窗口通信已中断，请重新启动助手" });
            return;
          }
          const id = `${documentId}:${++sequence}`;
          pending.set(id, { resolve, reject });
          calls.push({ id, args: [name, ...args] });
          if (!scheduled) {
            scheduled = true;
            queueMicrotask(() => { void flush(); });
          }
        });
      }
    },
  };
  target.__wwtWindowBridge = bridge;
  bridge.bind(configuration.names);
  window.addEventListener("pagehide", disconnect, { once: true });
}
