import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { dlopen, FFIType, ptr } from "bun:ffi";

const windowsErrorCode = { alreadyExists: 183 } as const;
const mutexInitialOwnerFlag = 0;

export function acquireProcessLock(path: string): () => void {
  const kernel = dlopen("kernel32.dll", {
    CreateMutexW: {
      args: [FFIType.ptr, FFIType.i32, FFIType.ptr],
      returns: FFIType.ptr,
    },
    GetLastError: { args: [], returns: FFIType.u32 },
    CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
  });
  const name = Buffer.from(`Local\\WWT-${createHash("sha256").update(resolve(path).toLowerCase()).digest("hex")}\0`, "utf16le");
  const handle = kernel.symbols.CreateMutexW(null, mutexInitialOwnerFlag, ptr(name));
  const existing = kernel.symbols.GetLastError() === windowsErrorCode.alreadyExists;
  if (!handle || existing) {
    if (handle) kernel.symbols.CloseHandle(handle);
    kernel.close();
    throw new Error("该目录正由另一个助手实例使用");
  }
  let released = false;
  return () => {
    if (!released) {
      released = true;
      kernel.symbols.CloseHandle(handle);
      kernel.close();
    }
  };
}
