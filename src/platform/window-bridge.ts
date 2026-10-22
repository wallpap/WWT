import { randomBytes } from "node:crypto";
import { installWindowBridge } from "./window-bridge-browser.ts";

type Handler = (...args: unknown[]) => unknown;
type Call = { id: string; args: [string, ...unknown[]] };
type Session = { documentId: string; controller: ReadableStreamDefaultController<Uint8Array>; closed: boolean };

export class WindowBridge {
  readonly #handlers = new Map<string, Handler>();
  readonly #token = randomBytes(32).toString("hex");
  readonly #encoder = new TextEncoder();
  readonly #server: ReturnType<typeof Bun.serve>;
  readonly #queuedScripts: string[] = [];
  #session: Session | undefined;
  #closed = false;

  constructor() {
    this.#server = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 0, fetch: (request) => this.#fetch(request) });
  }

  bind<Arguments extends unknown[]>(name: string, handler: (...args: Arguments) => unknown): void {
    this.#handlers.set(name, (...args) => handler(...(args as Arguments)));
  }

  bootstrapScript(): string {
    return `(${installWindowBridge.toString()})(${JSON.stringify({ endpoint: this.#server.url.origin, token: this.#token, names: [...this.#handlers.keys()] })});`;
  }

  evaluate(script: string): void {
    if (this.#closed) return;
    if (this.#session) this.#send(this.#session, { script });
    else this.#queuedScripts.push(script);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#session) this.#disconnect(this.#session);
    this.#queuedScripts.length = 0;
    this.#handlers.clear();
    void this.#server.stop(true);
  }

  async #fetch(request: Request): Promise<Response> {
    // file: 和 NavigateToString 页面使用不透明来源；端口、来源和令牌共同限定当前窗口。
    if (this.#closed || request.headers.get("host") !== this.#server.url.host || request.headers.get("origin") !== "null") {
      return new Response(null, { status: 403 });
    }
    const headers = {
      "access-control-allow-origin": "null",
      "access-control-allow-headers": "content-type,x-wwt-token,x-wwt-document",
      "access-control-allow-methods": "GET,POST",
      "cache-control": "no-store",
    };
    const path = new URL(request.url).pathname;
    if (path !== "/events" && path !== "/rpc") return new Response(null, { status: 404, headers });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const documentId = request.headers.get("x-wwt-document") ?? "";
    if (request.headers.get("x-wwt-token") !== this.#token || !/^[a-f0-9]{32}$/.test(documentId)) {
      return new Response(null, { status: 403, headers });
    }

    if (path === "/events" && request.method === "GET") {
      let session: Session;
      return new Response(new ReadableStream<Uint8Array>({
        start: (controller) => {
          if (this.#session) this.#disconnect(this.#session);
          session = { documentId, controller, closed: false };
          this.#session = session;
          controller.enqueue(this.#encoder.encode("\n"));
          for (const script of this.#queuedScripts.splice(0)) this.#send(session, { script });
        },
        cancel: () => this.#disconnect(session),
      }), { headers: { ...headers, "content-type": "application/x-ndjson" } });
    }
    if (path !== "/rpc" || request.method !== "POST") return new Response(null, { status: 405, headers });

    const session = this.#session;
    if (!session || session.documentId !== documentId) return new Response(null, { status: 409, headers });
    let calls: unknown;
    try {
      calls = await request.json();
    } catch {
      return new Response(null, { status: 400, headers });
    }
    if (!Array.isArray(calls) || !calls.every((call: unknown) => this.#isCall(call, documentId))) {
      return new Response(null, { status: 400, headers });
    }
    if (session.closed) return new Response(null, { status: 409, headers });
    // 独立完成各调用，避免长任务阻塞同一批中的进度查询和取消请求。
    for (const call of calls as Call[]) {
      void Promise.resolve().then(() => {
        const [name, ...args] = call.args;
        const handler = this.#handlers.get(name);
        if (!handler) throw new Error("窗口请求函数不存在");
        return handler(...args);
      }).then(
        (value) => this.#reply(session, call.id, 0, value ?? null),
        (error: unknown) => this.#reply(session, call.id, 1, this.#error(error)),
      );
    }
    return new Response(null, { status: 204, headers });
  }

  #isCall(value: unknown, documentId: string): value is Call {
    if (!value || typeof value !== "object") return false;
    const call = value as Partial<Call>;
    return typeof call.id === "string" && call.id.startsWith(`${documentId}:`) && Array.isArray(call.args) && typeof call.args[0] === "string";
  }

  #error(error: unknown): { message: string } {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  #reply(session: Session, id: string, status: number, value: unknown): void {
    try {
      this.#send(session, { id, status, value });
    } catch (error) {
      this.#send(session, { id, status: 1, value: this.#error(error) });
    }
  }

  #send(session: Session, value: unknown): void {
    if (session.closed) return;
    const data = this.#encoder.encode(`${JSON.stringify(value)}\n`);
    try {
      session.controller.enqueue(data);
    } catch {
      this.#disconnect(session);
    }
  }

  #disconnect(session: Session): void {
    if (session.closed) return;
    session.closed = true;
    if (this.#session === session) this.#session = undefined;
    try { session.controller.close(); } catch { /* 流取消时已经关闭。 */ }
  }
}
