import type { OfficialResourceFile } from "./official-resources.ts";
import type { ResourceUpdateOptions, ResourceUpdateResult } from "./resource-update.ts";

type InstallResources = (root: string, files: readonly OfficialResourceFile[], options: ResourceUpdateOptions) => Promise<ResourceUpdateResult>;

function sameFiles(left: readonly OfficialResourceFile[], right: readonly OfficialResourceFile[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((file, index) => {
    const other = right[index];
    return other !== undefined && file.path === other.path && file.size === other.size && file.md5 === other.md5 && file.url === other.url;
  });
}

export class ResourceUpdateWorkflow {
  #preview: { root: string; files: OfficialResourceFile[] } | null = null;
  #confirmed: { root: string; files: OfficialResourceFile[] } | null = null;
  #installing = false;
  #controller: AbortController | null = null;

  cancel(): boolean {
    if (this.#controller === null || this.#controller.signal.aborted) return false;
    this.#controller.abort(new Error("资源安装已取消"));
    return true;
  }

  constructor(private readonly install: InstallResources) {}

  get isInstalling(): boolean {
    return this.#installing;
  }

  preview(root: string, files: readonly OfficialResourceFile[]): number {
    if (this.#installing) throw new Error("正在安装资源，请等待完成");
    this.#preview = { root, files: files.map((file) => ({ ...file })) };
    this.#confirmed = null;
    return files.length;
  }

  confirm(root: string, files: readonly OfficialResourceFile[]): void {
    if (this.#installing) throw new Error("正在安装资源，请等待完成");
    if (this.#preview === null) throw new Error("请先生成资源安装计划");
    if (this.#preview.root !== root || !sameFiles(this.#preview.files, files)) {
      this.#preview = null;
      this.#confirmed = null;
      throw new Error("资源目录或官方清单已变化，请重新生成计划");
    }
    this.#confirmed = { root, files: files.map((file) => ({ ...file })) };
  }

  async execute(root: string, files: readonly OfficialResourceFile[], onProgress?: ResourceUpdateOptions["onProgress"]): Promise<ResourceUpdateResult> {
    if (this.#installing) throw new Error("正在安装资源，请等待完成");
    if (this.#confirmed === null) throw new Error("尚未确认资源安装计划");
    if (this.#confirmed.root !== root || !sameFiles(this.#confirmed.files, files)) {
      this.#preview = null;
      this.#confirmed = null;
      throw new Error("资源目录或官方清单已变化，请重新生成计划");
    }
    this.#preview = null;
    this.#confirmed = null;
    this.#installing = true;
    const controller = new AbortController();
    this.#controller = controller;
    try {
      return await this.install(root, files, {
        signal: controller.signal,
        ...(onProgress ? { onProgress } : {}),
      });
    } finally {
      this.#controller = null;
      this.#installing = false;
    }
  }
}
