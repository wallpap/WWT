import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, readFile, rename, rm, rmdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { OfficialResourceFile } from "./official-resources.ts";
import { ensureNoResourceSymlinks, normalizeResourcePath } from "./resource-path.ts";
import { millisecondsPerMinute } from "../units.ts";

const maxDownloadAttempts = 3;
const retryDelayMs = 250;
const httpStatus = {
  ok: 200,
  partialContent: 206,
  requestTimeout: 408,
  tooManyRequests: 429,
  internalServerError: 500,
} as const;
export interface ResourceDownloadOptions {
  signal?: AbortSignal;
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onBytes?: (bytes: number) => void | Promise<void>;
  beforeWrite?: (bytes: number) => Promise<void>;
}
interface Validator {
  etag: string;
  modified: string;
}
interface CachePaths {
  part: string;
  ready: string;
  metadata: string;
}
class DownloadError extends Error {
  constructor(
    message: string,
    readonly retry = false,
  ) {
    super(message);
  }
}
const active = new Set<string>();

export class ResourceDownloadCache {
  readonly directory: string;
  constructor(directory: string) {
    this.directory = resolve(directory);
  }

  #paths(file: OfficialResourceFile): CachePaths {
    const id = createHash("sha256")
      .update(JSON.stringify([normalizeResourcePath(file.path), file.size, file.md5?.toLowerCase() ?? file.url]))
      .digest("hex");
    return {
      part: join(this.directory, `${id}.part`),
      ready: join(this.directory, `${id}.ready`),
      metadata: join(this.directory, `${id}.json`),
    };
  }
  async #size(path: string): Promise<number> {
    await ensureNoResourceSymlinks(path);
    try {
      const info = await lstat(path);
      if (!info.isFile()) throw new Error("下载缓存不是普通文件");
      return info.size;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return -1;
      throw error;
    }
  }
  async #valid(path: string, file: OfficialResourceFile, signal?: AbortSignal): Promise<boolean> {
    if ((await this.#size(path)) !== file.size) return false;
    if (file.md5 === null) return true;
    const hash = createHash("md5");
    for await (const chunk of createReadStream(path)) {
      signal?.throwIfAborted();
      hash.update(chunk);
    }
    return hash.digest("hex") === file.md5.toLowerCase();
  }
  async #validator(path: string): Promise<Validator> {
    await ensureNoResourceSymlinks(path);
    try {
      const value = JSON.parse(await readFile(path, "utf8")) as unknown;
      if (typeof value === "object" && value !== null && "etag" in value && "modified" in value && typeof value.etag === "string" && typeof value.modified === "string") return { etag: value.etag, modified: value.modified };
    } catch (error) {
      if (!(error instanceof SyntaxError) && !(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    return { etag: "", modified: "" };
  }
  async #remove(paths: string[]): Promise<void> {
    for (const path of paths) {
      await ensureNoResourceSymlinks(path);
      await rm(path, { force: true });
    }
  }

  async download(file: OfficialResourceFile, options: ResourceDownloadOptions = {}): Promise<string> {
    if (!Number.isSafeInteger(file.size) || file.size < 0 || (file.md5 !== null && !/^[a-f\d]{32}$/i.test(file.md5))) throw new Error("资源下载信息无效");
    const paths = this.#paths(file);
    if (active.has(paths.part)) throw new Error("同一资源正在下载");
    active.add(paths.part);
    try {
      options.signal?.throwIfAborted();
      await ensureNoResourceSymlinks(this.directory);
      await mkdir(this.directory, { recursive: true });
      if (await this.#valid(paths.ready, file, options.signal)) {
        await options.onBytes?.(file.size);
        return paths.ready;
      }
      await this.#remove([paths.ready]);
      for (let attempt = 0; ; attempt++) {
        try {
          return await this.#attempt(file, paths, options);
        } catch (error) {
          options.signal?.throwIfAborted();
          if (!(error instanceof DownloadError && error.retry) || attempt >= maxDownloadAttempts - 1) throw error;
          await delay(retryDelayMs * (attempt + 1), undefined, options.signal ? { signal: options.signal } : {});
        }
      }
    } finally {
      active.delete(paths.part);
    }
  }

  async #attempt(file: OfficialResourceFile, paths: CachePaths, options: ResourceDownloadOptions): Promise<string> {
    let offset = await this.#size(paths.part);
    let validator = await this.#validator(paths.metadata);
    const ifRange = validator.etag && !validator.etag.startsWith("W/") ? validator.etag : validator.modified;
    if (offset > file.size || (offset > 0 && file.md5 === null && !ifRange)) {
      await this.#remove([paths.part, paths.metadata]);
      offset = -1;
    }
    if (offset === file.size && (await this.#valid(paths.part, file, options.signal))) {
      await rename(paths.part, paths.ready);
      await options.onBytes?.(file.size);
      return paths.ready;
    }
    if (offset === file.size) {
      await this.#remove([paths.part, paths.metadata]);
      offset = -1;
    }
    offset = Math.max(0, offset);
    await options.onBytes?.(offset);
    options.signal?.throwIfAborted();
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      timer = setTimeout(() => controller.abort(new Error("资源下载连接超时")), millisecondsPerMinute);
    };
    const disarm = () => {
      clearTimeout(timer);
      timer = undefined;
    };
    let response: Response;
    try {
      arm();
      response = await (options.fetcher ?? fetch)(file.url, {
        signal,
        redirect: "error",
        headers: {
          "Accept-Encoding": "identity",
          ...(offset
            ? {
                Range: `bytes=${offset}-`,
                ...(ifRange ? { "If-Range": ifRange } : {}),
              }
            : {}),
        },
      });
    } catch {
      throw new DownloadError(`资源连接失败：${file.path}`, true);
    } finally {
      disarm();
    }
    try {
      if (!response.ok) throw new DownloadError(`资源下载失败：${file.path}（HTTP ${response.status}）`, response.status === httpStatus.requestTimeout || response.status === httpStatus.tooManyRequests || response.status >= httpStatus.internalServerError);
      if (response.status === httpStatus.partialContent) {
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("Content-Range") ?? "");
        if (!range || Number(range[1]) !== offset || Number(range[3]) !== file.size || Number(range[2]) < offset || Number(range[2]) >= file.size) throw new DownloadError(`资源续传响应范围不符：${file.path}`);
        const etag = response.headers.get("ETag");
        if (offset && validator.etag && etag && validator.etag !== etag) {
          await this.#remove([paths.part, paths.metadata]);
          throw new DownloadError(`资源版本已变化：${file.path}`, true);
        }
      } else if (response.status === httpStatus.ok) offset = 0;
      else throw new DownloadError(`资源响应状态无效：${file.path}`);
      if (!response.body) throw new DownloadError(`资源响应没有内容：${file.path}`);
      validator = {
        etag: response.headers.get("ETag") ?? "",
        modified: response.headers.get("Last-Modified") ?? "",
      };
      await ensureNoResourceSymlinks(paths.metadata);
      const metadata = await open(paths.metadata, "w");
      try {
        await metadata.writeFile(JSON.stringify(validator));
      } finally {
        await metadata.close();
      }
      await ensureNoResourceSymlinks(paths.part);
      const handle = await open(paths.part, offset ? "a" : "w");
      const reader = response.body.getReader();
      let bytes = offset;
      try {
        await options.onBytes?.(bytes);
        while (true) {
          signal.throwIfAborted();
          let chunk: Awaited<ReturnType<typeof reader.read>>;
          try {
            arm();
            chunk = await reader.read();
          } catch {
            throw new DownloadError(`资源传输中断：${file.path}`, true);
          } finally {
            disarm();
          }
          if (chunk.done) break;
          if (bytes + chunk.value.byteLength > file.size) {
            await handle.truncate(0);
            throw new DownloadError(`资源下载大小不符：${file.path}`);
          }
          await options.beforeWrite?.(chunk.value.byteLength);
          signal.throwIfAborted();
          let written = 0;
          while (written < chunk.value.byteLength) {
            const next = await handle.write(chunk.value.subarray(written));
            if (!next.bytesWritten) throw new Error(`资源写入失败：${file.path}`);
            written += next.bytesWritten;
          }
          bytes += chunk.value.byteLength;
          await options.onBytes?.(bytes);
        }
      } finally {
        await handle.close();
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (bytes !== file.size) throw new DownloadError(`资源下载大小不符：${file.path}`, true);
      if (!(await this.#valid(paths.part, file, options.signal))) {
        await this.#remove([paths.part, paths.metadata]);
        throw new DownloadError(`资源 MD5 校验失败：${file.path}`, true);
      }
      await rename(paths.part, paths.ready);
      return paths.ready;
    } finally {
      controller.abort();
      await response.body?.cancel().catch(() => {});
    }
  }

  async discard(file: OfficialResourceFile): Promise<void> {
    const paths = this.#paths(file);
    if (active.has(paths.part)) throw new Error("同一资源正在下载");
    await this.#remove([paths.ready, paths.part, paths.metadata]);
    try {
      await rmdir(this.directory);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && ["ENOENT", "ENOTEMPTY", "EEXIST"].includes(String(error.code)))) throw error;
    }
  }
}
