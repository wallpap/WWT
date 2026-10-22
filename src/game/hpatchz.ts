import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ensureNoResourceSymlinks } from "./resource-path.ts";

export const hpatchzSha256 = "234168f765294a5db867163e639c9288f04f976976bdf80da29fbba9eae39917";
export const hpatchzPath = Bun.isStandaloneExecutable ? join(dirname(process.execPath), "hpatchz.exe") : resolve(import.meta.dir, "../../vendor/hdiffpatch/hpatchz.exe");

export async function verifyHpatchz(path = hpatchzPath): Promise<void> {
  await ensureNoResourceSymlinks(path);
  if (
    createHash("sha256")
      .update(await readFile(path))
      .digest("hex") !== hpatchzSha256
  )
    throw new Error("HPatchZ 组件校验失败，请重新解压便携包");
}

export async function applyHpatchz(oldDirectory: string, patch: string, outputDirectory: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await verifyHpatchz();
  await ensureNoResourceSymlinks(oldDirectory);
  await ensureNoResourceSymlinks(patch);
  await ensureNoResourceSymlinks(outputDirectory);
  signal?.throwIfAborted();
  const child = Bun.spawn([hpatchzPath, "-f", "-s-4m", "-C-all", resolve(oldDirectory), resolve(patch), resolve(outputDirectory)], {
    stdout: "ignore",
    stderr: "ignore",
    windowsHide: true,
  });
  const abort = () => {
    child.kill();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) abort();
    const code = await child.exited;
    signal?.throwIfAborted();
    if (code !== 0) throw new Error(`HPatchZ 差分执行失败（退出码 ${code}）`);
  } finally {
    signal?.removeEventListener("abort", abort);
    // 等待原生进程退出后，调用方才能清理输出目录。
    await child.exited;
  }
}
