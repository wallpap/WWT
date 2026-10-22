import { dlopen, FFIType, ptr } from "bun:ffi";

const showCommandNormal = 1;
const shellExecuteFailureThreshold = 32;

export function openWithSystem(target: string): void {
  if (target.includes("\0")) throw new Error("打开目标无效");
  const shell = dlopen("shell32.dll", {
    ShellExecuteW: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.i32],
      returns: FFIType.i64,
    },
  });
  const verb = Buffer.from("open\0", "utf16le"),
    path = Buffer.from(`${target}\0`, "utf16le");
  try {
    if (Number(shell.symbols.ShellExecuteW(null, ptr(verb), ptr(path), null, null, showCommandNormal)) <= shellExecuteFailureThreshold) throw new Error("系统无法打开所选目标");
  } finally {
    shell.close();
  }
}
