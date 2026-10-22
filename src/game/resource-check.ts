import { createHash } from "node:crypto";
import { type Stats, createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { LocalResourceFile } from "./local-manifest.ts";
import { ensureNoResourceSymlinks, normalizeResourcePath } from "./resource-path.ts";

const verifiedFileCacheLimit = 20_000;

export type ResourceFileState = "valid" | "missing" | "size-mismatch" | "hash-mismatch" | "unchecked";

export interface ResourceFileCheck {
  path: string;
  expectedSize: number;
  actualSize: number | null;
  expectedMd5: string | null;
  actualMd5: string | null;
  state: ResourceFileState;
}

export interface ResourceCheckSummary {
  checkedCount: number;
  validCount: number;
  missingCount: number;
  sizeMismatchCount: number;
  hashMismatchCount: number;
  uncheckedCount: number;
  files: ResourceFileCheck[];
}

function withinRoot(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath !== ".." && !relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(relativePath);
}

const verifiedFiles = new Map<string, { fingerprint: string; md5: string }>();
const fileFingerprint = (info: Stats) => JSON.stringify([info.size, info.mtimeMs, info.ctimeMs, info.ino, info.dev]);

async function md5File(path: string, signal?: AbortSignal, onBytes?: (bytes: number) => void): Promise<string> {
  const hash = createHash("md5");
  for await (const chunk of createReadStream(path, { signal })) {
    signal?.throwIfAborted();
    hash.update(chunk as Uint8Array);
    onBytes?.((chunk as Uint8Array).length);
  }
  return hash.digest("hex");
}

export async function checkLocalResources(
  rootDirectory: string,
  files: readonly LocalResourceFile[],
  options: {
    signal?: AbortSignal;
    reuseVerified?: boolean;
    onProgress?: (completedBytes: number, path: string) => void;
  } = {},
): Promise<ResourceCheckSummary> {
  const root = resolve(rootDirectory);
  const checks: ResourceFileCheck[] = [];
  let completedBytes = 0;
  options.signal?.throwIfAborted();
  for (const expected of files) {
    options.signal?.throwIfAborted();
    const candidate = resolve(join(root, normalizeResourcePath(expected.path)));
    if (!withinRoot(root, candidate)) throw new Error(`资源路径超出游戏目录：${expected.path}`);
    await ensureNoResourceSymlinks(candidate);
    let actualSize: number | null = null;
    let fingerprint = "";
    try {
      const information = await stat(candidate);
      if (!information.isFile()) {
        checks.push({
          path: expected.path,
          expectedSize: expected.size,
          actualSize: null,
          expectedMd5: expected.md5,
          actualMd5: null,
          state: "missing",
        });
        continue;
      }
      actualSize = information.size;
      fingerprint = fileFingerprint(information);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        checks.push({
          path: expected.path,
          expectedSize: expected.size,
          actualSize: null,
          expectedMd5: expected.md5,
          actualMd5: null,
          state: "missing",
        });
        continue;
      }
      throw error;
    }
    if (actualSize !== expected.size) {
      checks.push({
        path: expected.path,
        expectedSize: expected.size,
        actualSize,
        expectedMd5: expected.md5,
        actualMd5: null,
        state: "size-mismatch",
      });
      continue;
    }
    if (expected.md5 === null) {
      checks.push({
        path: expected.path,
        expectedSize: expected.size,
        actualSize,
        expectedMd5: null,
        actualMd5: null,
        state: "unchecked",
      });
      continue;
    }
    const previous = verifiedFiles.get(candidate);
    let actualMd5: string;
    if (options.reuseVerified && previous?.fingerprint === fingerprint && previous.md5 === expected.md5) {
      actualMd5 = previous.md5;
      completedBytes += expected.size;
      options.onProgress?.(completedBytes, expected.path);
    } else {
      actualMd5 = await md5File(candidate, options.signal, (bytes) => {
        completedBytes += bytes;
        options.onProgress?.(completedBytes, expected.path);
      });
      if (fileFingerprint(await stat(candidate)) !== fingerprint) throw new Error("校验期间资源已变化，请重新检查");
      if (verifiedFiles.size >= verifiedFileCacheLimit) verifiedFiles.clear();
      verifiedFiles.set(candidate, { fingerprint, md5: actualMd5 });
    }
    checks.push({
      path: expected.path,
      expectedSize: expected.size,
      actualSize,
      expectedMd5: expected.md5,
      actualMd5,
      state: actualMd5 === expected.md5 ? "valid" : "hash-mismatch",
    });
  }
  return {
    checkedCount: checks.length,
    validCount: checks.filter((check) => check.state === "valid").length,
    missingCount: checks.filter((check) => check.state === "missing").length,
    sizeMismatchCount: checks.filter((check) => check.state === "size-mismatch").length,
    hashMismatchCount: checks.filter((check) => check.state === "hash-mismatch").length,
    uncheckedCount: checks.filter((check) => check.state === "unchecked").length,
    files: checks,
  };
}
