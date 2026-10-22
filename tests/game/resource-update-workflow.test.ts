import { describe, expect, test } from "bun:test";
import { ResourceUpdateWorkflow } from "../../src/game/resource-update-workflow.ts";
import type { OfficialResourceFile } from "../../src/game/official-resources.ts";

const files: OfficialResourceFile[] = [{ path: "a", size: 1, md5: null, url: "https://example.invalid/a" }];

describe("ResourceUpdateWorkflow", () => {
  test("cancels the active request and holds the lock until cleanup completes", async () => {
    let finish!: () => void;
    let signal!: AbortSignal;
    const workflow = new ResourceUpdateWorkflow(async (_root, _files, options) => {
      signal = options.signal!;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      signal.throwIfAborted();
      return { installedFiles: 1, installedBytes: 1 };
    });
    expect(workflow.cancel()).toBe(false);
    workflow.preview("C:\\Game", files);
    workflow.confirm("C:\\Game", files);
    const pending = workflow.execute("C:\\Game", files);
    expect(workflow.cancel()).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(workflow.cancel()).toBe(false);
    expect(workflow.isInstalling).toBe(true);
    finish();
    await expect(pending).rejects.toThrow("已取消");
    expect(workflow.isInstalling).toBe(false);
    await expect(workflow.execute("C:\\Game", files)).rejects.toThrow("尚未确认");
    workflow.preview("C:\\Game", files);
    workflow.confirm("C:\\Game", files);
    const retry = workflow.execute("C:\\Game", files);
    expect(signal.aborted).toBe(false);
    finish();
    await retry;
  });

  test("blocks overlapping installations until the active install settles", async () => {
    let finish!: () => void;
    const workflow = new ResourceUpdateWorkflow(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { installedFiles: 1, installedBytes: 1 };
    });
    workflow.preview("C:\\Game", files);
    workflow.confirm("C:\\Game", files);
    const pending = workflow.execute("C:\\Game", files);
    try {
      expect(() => workflow.preview("C:\\Game", files)).toThrow("正在安装");
    } finally {
      finish();
      await pending;
    }
    expect(() => workflow.preview("C:\\Game", files)).not.toThrow();
  });

  test("requires a fresh preview and confirmation, then consumes it once", async () => {
    let installs = 0;
    const workflow = new ResourceUpdateWorkflow(async () => {
      installs += 1;
      return { installedFiles: 1, installedBytes: 1 };
    });
    await expect(workflow.execute("C:\\Game", files)).rejects.toThrow("尚未确认");
    workflow.preview("C:\\Game", files);
    expect(() => workflow.confirm("C:\\Game", files)).not.toThrow();
    await workflow.execute("C:\\Game", files);
    expect(installs).toBe(1);
    await expect(workflow.execute("C:\\Game", files)).rejects.toThrow("尚未确认");
  });

  test("invalidates confirmation when the manifest changes", () => {
    const workflow = new ResourceUpdateWorkflow(async () => ({
      installedFiles: 0,
      installedBytes: 0,
    }));
    workflow.preview("C:\\Game", files);
    expect(() => workflow.confirm("C:\\Game", [{ ...files[0]!, size: 2 }])).toThrow("已变化");
    expect(() => workflow.confirm("C:\\Game", files)).toThrow("先生成");
  });
});
