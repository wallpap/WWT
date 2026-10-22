import type { OfficialResourceFile } from "./official-resources.ts";
import type { ResourceUpdateOptions } from "./resource-update.ts";
import { ResourceDownloadCache } from "./resource-download.ts";
import { BandwidthLimiter, validateDownloadPolicy } from "./download-policy.ts";

export async function downloadResourceFiles(files: readonly OfficialResourceFile[], cache: ResourceDownloadCache, options: ResourceUpdateOptions, ready: (file: OfficialResourceFile, cachedPath: string) => Promise<void> = async () => {}): Promise<void> {
  const policy = validateDownloadPolicy({
    parallel: options.parallel ?? 1,
    bytesPerSecond: options.bytesPerSecond ?? 0,
  });
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  let completedBytes = 0;
  let completedFiles = 0;
  let next = 0;
  const transferred = files.map(() => 0);
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const limiter = new BandwidthLimiter(policy.bytesPerSecond);
  let progressQueue = Promise.resolve();
  function emit(path: string): Promise<void> {
    const snapshot = {
      path,
      completedFiles,
      totalFiles: files.length,
      completedBytes,
      totalBytes,
    };
    const result = progressQueue.then(() => options.onProgress?.(snapshot));
    progressQueue = result.catch(() => {});
    return result;
  }
  async function worker(): Promise<void> {
    try {
      while (next < files.length) {
        signal.throwIfAborted();
        const index = next++;
        const file = files[index]!;
        await emit(file.path);
        signal.throwIfAborted();
        const cached = await cache.download(file, {
          signal,
          ...(options.fetcher ? { fetcher: options.fetcher } : {}),
          beforeWrite: (bytes) => limiter.consume(bytes, signal),
          onBytes: async (bytes) => {
            completedBytes += bytes - transferred[index]!;
            transferred[index] = bytes;
            await emit(file.path);
          },
        });
        signal.throwIfAborted();
        await ready(file, cached);
        completedFiles++;
        await emit(file.path);
      }
    } catch (error) {
      controller.abort(error);
      throw error;
    }
  }
  // 所有 worker 停稳后才能由调用方清理暂存文件。
  await Promise.allSettled(Array.from({ length: Math.min(policy.parallel, files.length) }, worker));
  signal.throwIfAborted();
}
