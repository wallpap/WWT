import { setTimeout as delay } from "node:timers/promises";
import { millisecondsPerSecond } from "../units.ts";

const minimumDownloadParallel = 1;
const maximumDownloadParallel = 16;

export interface DownloadPolicy {
  parallel: number;
  bytesPerSecond: number;
}
export function validateDownloadPolicy(value: DownloadPolicy): DownloadPolicy {
  if (!Number.isInteger(value.parallel) || value.parallel < minimumDownloadParallel || value.parallel > maximumDownloadParallel) throw new Error(`同时下载数需为 ${minimumDownloadParallel}—${maximumDownloadParallel} 的整数`);
  if (!Number.isSafeInteger(value.bytesPerSecond) || value.bytesPerSecond < 0) throw new Error("下载限速需为非负整数字节数");
  return { parallel: value.parallel, bytesPerSecond: value.bytesPerSecond };
}

export class BandwidthLimiter {
  #availableAt = 0;
  constructor(
    private readonly bytesPerSecond: number,
    private readonly now = () => performance.now(),
    private readonly wait = (milliseconds: number, signal?: AbortSignal) => delay(milliseconds, undefined, signal ? { signal } : {}),
  ) {}
  async consume(bytes: number, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.bytesPerSecond === 0 || bytes === 0) return;
    const now = this.now();
    this.#availableAt = Math.max(now, this.#availableAt) + (bytes / this.bytesPerSecond) * millisecondsPerSecond;
    let remaining = Math.ceil(this.#availableAt - now);
    while (remaining > 0) {
      const interval = Math.min(remaining, millisecondsPerSecond);
      await this.wait(interval, signal);
      remaining -= interval;
    }
    signal?.throwIfAborted();
  }
}
