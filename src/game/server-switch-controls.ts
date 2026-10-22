import type { ServerSwitchStatus, SwitchSource } from "./server-switch.ts";
import type { ResourceUpdateProgress } from "./resource-update.ts";
import { bytesPerMebibyte } from "../units.ts";

export type ServerOperation = "inspect" | "prepare" | "apply" | "delete";
export function initializeServerSwitchControls(path: HTMLInputElement, canStart: () => boolean, setBusy: (value: boolean) => void, changed: () => void): { refresh: () => void; invalidate: () => void } {
  const find = <T extends HTMLElement>(id: string): T => document.querySelector<T>(`#${id}`)!;
  const source = find<HTMLSelectElement>("server-switch-source"),
    notice = find<HTMLElement>("server-switch-notice");
  const inspect = find<HTMLButtonElement>("server-switch-inspect"),
    prepare = find<HTMLButtonElement>("server-switch-prepare"),
    apply = find<HTMLButtonElement>("server-switch-apply"),
    clear = find<HTMLButtonElement>("server-switch-clear"),
    cancel = find<HTMLButtonElement>("server-switch-cancel");
  let busy = false,
    cancelling = false,
    status: ServerSwitchStatus | null = null;
  function refresh(): void {
    const enabled = !busy && canStart() && Boolean(path.value.trim());
    source.disabled = busy || !canStart();
    inspect.disabled = !enabled;
    prepare.disabled = !enabled;
    apply.disabled = !enabled || !status?.[source.value as SwitchSource]?.ready;
    clear.disabled = !enabled;
    cancel.hidden = !busy;
  }
  function describe(next: ServerSwitchStatus): string {
    const names = { mainland: "国内官服", bilibili: "B 服" };
    return `当前：${next.activeSource ? names[next.activeSource] : "未识别，可用目标缓存修复"}；官服缓存：${next.mainland.ready ? next.mainland.version || "已就绪" : "未就绪"}；B 服缓存：${next.bilibili.ready ? next.bilibili.version || "已就绪" : "未就绪"}。`;
  }
  async function run(operation: ServerOperation): Promise<void> {
    if (busy || !canStart() || !path.value.trim()) return;
    busy = true;
    cancelling = false;
    setBusy(true);
    refresh();
    notice.dataset["kind"] = "info";
    cancel.disabled = false;
    notice.textContent = {
      inspect: "正在识别服务器并检查缓存…",
      prepare: "正在下载和校验服务器组件…",
      apply: "正在备份当前组件并切换服务器…",
      delete: "正在清理所选服务器缓存…",
    }[operation];
    try {
      const result = await window.runServerOperation(path.value.trim(), operation, source.value as SwitchSource);
      status = result.status;
      notice.textContent = `${operation === "apply" ? "切换完成。" : operation === "prepare" ? "缓存准备完成。" : operation === "delete" ? "缓存已清理。" : ""}${describe(status)}${result.notice ? ` ${result.notice}` : ""}`;
      if (operation === "apply") changed();
    } catch (error) {
      notice.dataset["kind"] = "error";
      notice.textContent = error instanceof Error ? error.message : typeof error === "object" && error !== null && "message" in error ? String(error.message) : "服务器文件操作失败";
    } finally {
      busy = false;
      setBusy(false);
      refresh();
    }
  }
  for (const [button, action] of [
    [inspect, "inspect"],
    [prepare, "prepare"],
    [apply, "apply"],
    [clear, "delete"],
  ] as const)
    button.addEventListener("click", () => run(action));
  cancel.addEventListener("click", async () => {
    if (!busy) return;
    cancel.disabled = true;
    cancelling = true;
    notice.textContent = "正在取消，等待组件备份或下载结束…";
    try {
      await window.cancelServerOperation();
    } catch (error) {
      cancel.disabled = false;
      cancelling = false;
      notice.textContent = error instanceof Error ? error.message : "取消失败，请等待当前操作结束";
    }
  });
  source.addEventListener("change", refresh);
  window.addEventListener("server-switch-progress", (event) => {
    if (!busy || cancelling) return;
    const progress = (event as CustomEvent<ResourceUpdateProgress>).detail;
    notice.textContent = `下载组件 ${progress.completedFiles}/${progress.totalFiles} · ${(progress.completedBytes / bytesPerMebibyte).toFixed(1)} / ${(progress.totalBytes / bytesPerMebibyte).toFixed(1)} MB`;
  });
  refresh();
  return {
    refresh,
    invalidate: () => {
      status = null;
      notice.textContent = "检查当前服务器，准备目标缓存后即可切换或修复。";
      refresh();
    },
  };
}
