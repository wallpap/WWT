import { diagnostic } from "../platform/diagnostics.ts";

let notify = () => {};
export function onCacheWarning(callback: () => void): void {
  notify = callback;
}
export async function saveOptionalCache(operation: Promise<unknown>): Promise<void> {
  try {
    await operation;
  } catch {
    diagnostic("cache.save.failed");
    notify();
  }
}
