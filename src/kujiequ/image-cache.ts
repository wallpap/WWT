import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { appPaths } from "../platform/app-paths.ts";

const maxImageBytes = 8 * 1024 * 1024;

function imageMime(bytes: Uint8Array): string {
  const data = Buffer.from(bytes);
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg";
  if (data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  throw new Error("资源图片格式无效");
}

export class GameImageCache {
  #pending = new Map<string, Promise<string>>();
  #active = 0;
  #waiting: (() => void)[] = [];
  #shutdown = new AbortController();

  constructor(
    private readonly directory = join(appPaths.dataDirectory, "image-cache"),
    private readonly request: (url: string, options: RequestInit) => Promise<Response> = fetch,
    private readonly parallel = 4,
  ) {
    if (!Number.isInteger(parallel) || parallel < 1 || parallel > 8) throw new Error("图片下载并发应为 1—8");
  }

  cancel(): void {
    this.#shutdown.abort();
  }

  load(source: string): Promise<string> {
    let url: URL;
    try {
      url = new URL(source);
      const allowed = ["kurobbs.com", "kurogame.com", "kurogame.net", "kurogame.xyz", "raw.githubusercontent.com", "api.encore.moe"];
      if (url.protocol !== "https:" || url.username || url.password || url.port || !allowed.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error();
    } catch {
      return Promise.reject(new Error("资源图片地址无效"));
    }
    const key = url.href;
    const pending = this.#pending.get(key);
    if (pending) return pending;
    const operation = this.#load(key).finally(() => this.#pending.delete(key));
    this.#pending.set(key, operation);
    return operation;
  }

  async #load(source: string): Promise<string> {
    const path = join(this.directory, `${createHash("sha256").update(source).digest("hex")}.img`);
    try {
      const bytes = await readFile(path);
      return `data:${imageMime(bytes)};base64,${bytes.toString("base64")}`;
    } catch {
      // 缓存缺失或损坏时重新获取原图。
    }
    if (this.#active >= this.parallel) await new Promise<void>((resolve) => this.#waiting.push(resolve));
    else this.#active++;
    try {
      this.#shutdown.signal.throwIfAborted();
      const response = await this.request(source, { redirect: "error", signal: AbortSignal.any([this.#shutdown.signal, AbortSignal.timeout(15_000)]) });
      if (!response.ok || !response.body) throw new Error("资源图片下载失败");
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > maxImageBytes) throw new Error("资源图片过大");
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const mime = imageMime(bytes);
      await mkdir(this.directory, { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, bytes);
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
      return `data:${mime};base64,${bytes.toString("base64")}`;
    } finally {
      const next = this.#waiting.shift();
      if (next) next();
      else this.#active--;
    }
  }
}

