import { diagnostic } from "../platform/diagnostics.ts";
import { setTimeout as delay } from "node:timers/promises";
import { decode, object, text, type KuroRole, type KuroSession } from "./model.ts";
import { kuroGameId } from "./constants.ts";
import { millisecondsPerMinute, millisecondsPerSecond } from "../units.ts";

const kuroRequestIntervalMs = 2 * millisecondsPerSecond;
const kuroRequestTimeoutMs = 20 * millisecondsPerSecond;
const kuroAccessTokenLifetimeMs = 55 * millisecondsPerMinute;
const kuroApiCode = {
  success: 0,
  legacySuccess: 200,
  sessionExpired: 220,
  acceptedChallenge: 10902,
} as const;
const acceptedKuroApiCodes: ReadonlySet<number> = new Set([kuroApiCode.success, kuroApiCode.legacySuccess, kuroApiCode.acceptedChallenge]);

interface Envelope {
  code: number;
  data: unknown;
}
interface RoleRequestOptions {
  multipart?: boolean;
  query?: boolean;
  retryExpired?: boolean;
  sessionToken?: boolean;
}
export class KuroApi {
  #queue: Promise<unknown> = Promise.resolve();
  #next = 0;
  #pendingAccess = new Map<string, Promise<string>>();
  #shutdown = new AbortController();
  #roleQueries = new AbortController();
  cancelRoleQueries(): void {
    this.#roleQueries.abort();
    this.#roleQueries = new AbortController();
    this.#pendingAccess.clear();
  }
  cancel(): void {
    this.#shutdown.abort(new Error("应用正在退出"));
  }
  #access = new Map<string, { token: string; expires: number }>();
  constructor(
    private readonly request: (url: string, options: RequestInit) => Promise<Response> = fetch,
    private readonly interval = kuroRequestIntervalMs,
  ) {}

  clearAccess(sessionId: string): void {
    this.cancelRoleQueries();
    for (const key of this.#access.keys()) if (key.startsWith(`${sessionId}:`)) this.#access.delete(key);
  }

  async #waitForSlot(signal?: AbortSignal): Promise<void> {
    const combined = signal ? AbortSignal.any([this.#shutdown.signal, signal]) : this.#shutdown.signal;
    combined.throwIfAborted();
    const wait = Math.max(0, this.#next - performance.now());
    if (wait > 0) await delay(wait, undefined, { signal: combined });
    combined.throwIfAborted();
    this.#next = performance.now() + this.interval;
  }

  async send(
    path: string,
    session: Pick<KuroSession, "token" | "did" | "source">,
    fields: Record<string, string> = {},
    options: {
      query?: boolean;
      access?: string;
      multipart?: boolean;
      signal?: AbortSignal;
    } = {},
  ): Promise<Envelope> {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("?") || path.includes("#")) throw new Error("库街区接口路径无效");
    const operation = this.#queue.then(async () => {
      await this.#waitForSlot(options.signal);
      const headers: Record<string, string> = {
        source: session.source,
        did: session.did,
        devcode: session.did,
        origin: "https://web-static.kurobbs.com",
        "x-requested-with": "com.kurogame.kjq",
        "User-Agent": "Mozilla/5.0 (Linux; Android 9) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36 Kuro/2.5.0 KuroGameBox/2.5.0",
      };
      if (session.token) headers["token"] = session.token;
      if (path === "/user/getSmsCodeForH5") headers["version"] = "3.1.3";
      if (options.access) headers["B-At"] = options.access;
      const params = new URLSearchParams(fields);
      let body: BodyInit | undefined;
      if (options.multipart) {
        const form = new FormData();
        for (const [key, value] of Object.entries(fields)) form.set(key, value);
        body = form;
      } else {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        if (!options.query) body = params;
      }
      let raw: unknown;
      const started = performance.now();
      let status: number | undefined;
      let stage = "request";
      try {
        const response = await this.request(`https://api.kurobbs.com${path}${options.query ? `?${params}` : ""}`, {
          method: "POST",
          headers,
          ...(body !== undefined ? { body } : {}),
          redirect: "error",
          signal: AbortSignal.any([AbortSignal.timeout(kuroRequestTimeoutMs), this.#shutdown.signal, ...(options.signal ? [options.signal] : [])]),
        });
        status = response.status;
        stage = "http";
        if (!response.ok) throw new Error();
        stage = "decode";
        raw = await response.json();
      } catch {
        diagnostic("kuro.request.failed", {
          path,
          stage,
          ...(status === undefined ? {} : { status }),
          elapsedMs: Math.round(performance.now() - started),
        });
        throw new Error("库街区请求失败，请检查网络后重试");
      }
      const result = object(raw);
      diagnostic("kuro.request.completed", {
        path,
        ...(status === undefined ? {} : { status }),
        ...(typeof result["code"] === "number" ? { code: result["code"] } : {}),
        elapsedMs: Math.round(performance.now() - started),
      });
      if (typeof result["code"] !== "number") throw new Error("库街区响应缺少状态码");
      return { code: result["code"], data: result["data"] };
    });
    this.#queue = operation.catch(() => {});
    return operation;
  }

  async get(path: string, session: Pick<KuroSession, "token" | "did" | "source">, fields: Record<string, string> = {}): Promise<Envelope> {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("?") || path.includes("#")) throw new Error("库街区接口路径无效");
    const operation = this.#queue.then(async () => {
      await this.#waitForSlot();
      const headers: Record<string, string> = {
        source: session.source,
        did: session.did,
        devcode: session.did,
        origin: "https://web-static.kurobbs.com",
        "x-requested-with": "com.kurogame.kjq",
        "User-Agent": "Mozilla/5.0 (Linux; Android 9) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36 Kuro/2.5.0 KuroGameBox/2.5.0",
      };
      if (session.token) headers["token"] = session.token;
      let raw: unknown;
      const started = performance.now();
      let status: number | undefined;
      let stage = "request";
      try {
        const query = new URLSearchParams(fields);
        const response = await this.request(`https://api.kurobbs.com${path}${query.size ? `?${query}` : ""}`, {
          method: "GET",
          headers,
          redirect: "error",
          signal: AbortSignal.any([AbortSignal.timeout(kuroRequestTimeoutMs), this.#shutdown.signal]),
        });
        status = response.status;
        stage = "http";
        if (!response.ok) throw new Error();
        stage = "decode";
        raw = await response.json();
      } catch {
        diagnostic("kuro.request.failed", {
          path,
          stage,
          ...(status === undefined ? {} : { status }),
          elapsedMs: Math.round(performance.now() - started),
        });
        throw new Error("库街区请求失败，请检查网络后重试");
      }
      const result = object(raw);
      diagnostic("kuro.request.completed", {
        path,
        ...(status === undefined ? {} : { status }),
        ...(typeof result["code"] === "number" ? { code: result["code"] } : {}),
        elapsedMs: Math.round(performance.now() - started),
      });
      if (typeof result["code"] !== "number") throw new Error("库街区响应缺少状态码");
      return { code: result["code"], data: result["data"] };
    });
    this.#queue = operation.catch(() => {});
    return operation;
  }

  success(response: Envelope): unknown {
    if (response.code === kuroApiCode.sessionExpired) throw new Error("库街区登录已失效，请重新登录");
    if (!acceptedKuroApiCodes.has(response.code)) throw new Error(`库街区操作未成功（${response.code}）`);
    return decode(response.data);
  }

  async roles(session: KuroSession): Promise<KuroRole[]> {
    const data = this.success(await this.send("/gamer/role/list", session, { gameId: kuroGameId }, { query: true }));
    if (!Array.isArray(data)) throw new Error("绑定角色列表格式无效");
    return data.map((item) => {
      const row = object(item);
      const role = {
        roleId: text(row["roleId"]),
        roleName: text(row["roleName"]),
        userId: text(row["userId"]),
        serverId: text(row["serverId"]) || "76402e5b20be2c39f095a152090afddc",
        serverName: text(row["serverName"]),
      };
      if (!role.roleId || !role.userId) throw new Error("绑定角色缺少身份信息");
      return role;
    });
  }

  async #getAccess(session: KuroSession, role: KuroRole, signal: AbortSignal): Promise<string> {
    const key = `${session.id}:${role.userId}:${role.roleId}:${role.serverId}`;
    const cached = this.#access.get(key);
    if (cached && cached.expires > Date.now()) return cached.token;
    const pending = this.#pendingAccess.get(key);
    if (pending) return pending;
    const operation = this.#requestAccess(session, role, key, signal);
    this.#pendingAccess.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.#pendingAccess.get(key) === operation) this.#pendingAccess.delete(key);
    }
  }

  async #requestAccess(session: KuroSession, role: KuroRole, key: string, signal: AbortSignal): Promise<string> {
    const response = await this.send(
      "/aki/roleBox/requestToken",
      { ...session, source: "android" },
      {
        serverId: role.serverId,
        roleId: role.roleId,
        userId: role.userId,
      },
      { query: true, signal },
    );
    if (response.code === kuroApiCode.sessionExpired && session.source === "h5") {
      diagnostic("kuro.authorization.rejected", {
        code: response.code,
        stage: "h5-session",
      });
      throw new Error("当前账号使用网页登录会话，无法获取角色数据，请重新登录以建立客户端会话");
    }
    const raw = object(this.success(response));
    signal.throwIfAborted();
    const token = text(raw["accessToken"]) || text(raw["access_token"]) || text(raw["token"]);
    if (!token) throw new Error("库街区未返回角色访问凭据");
    this.#access.set(key, { token, expires: Date.now() + kuroAccessTokenLifetimeMs });
    return token;
  }

  async roleRequest(path: string, session: KuroSession, role: KuroRole, extra: Record<string, string> = {}, options: RoleRequestOptions = {}): Promise<unknown> {
    const signal = this.#roleQueries.signal;
    const { multipart = false, query = false, retryExpired = true } = options;
    const fields = {
      gameId: kuroGameId,
      serverId: role.serverId,
      roleId: role.roleId,
      ...(!multipart && !query ? { userId: role.userId } : {}),
      ...extra,
    };
    const requestSession: KuroSession = {
      ...session,
      source: multipart ? "android" : session.source,
      token: (options.sessionToken ?? !multipart) ? session.token : "",
    };
    const access = await this.#getAccess(session, role, signal);
    let result = await this.send(path, requestSession, fields, {
      access,
      multipart,
      query,
      signal,
    });
    if (result.code === kuroApiCode.sessionExpired && retryExpired) {
      this.#access.delete(`${session.id}:${role.userId}:${role.roleId}:${role.serverId}`);
      result = await this.send(path, requestSession, fields, {
        access: await this.#getAccess(session, role, signal),
        multipart,
        query,
        signal,
      });
    }
    return this.success(result);
  }
}
