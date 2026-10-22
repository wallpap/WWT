import { dlopen, FFIType, ptr } from "bun:ffi";
import { openWithSystem } from "./shell.ts";
import { confirmStartupAction } from "./windows-dialog.ts";

const runtimeClient = "Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
const downloadPage = "https://developer.microsoft.com/microsoft-edge/webview2/";

export function hasWebView2Runtime(): boolean {
  const registry = dlopen("advapi32.dll", {
    RegGetValueW: {
      args: [FFIType.i64, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    },
  });
  const valueName = Buffer.from("pv\0", "utf16le");
  try {
    // 微软分别使用机器级的 32 位注册表路径和当前用户路径登记运行时。
    for (const [hive, path] of [
      [-2147483646, `SOFTWARE\\WOW6432Node\\${runtimeClient}`],
      [-2147483647, `Software\\${runtimeClient}`],
    ] as const) {
      const key = Buffer.from(`${path}\0`, "utf16le");
      const version = Buffer.alloc(512);
      const size = new Uint32Array([version.length]);
      const status = registry.symbols.RegGetValueW(hive, ptr(key), ptr(valueName), 0x02, null, ptr(version), ptr(size));
      if (status !== 0) continue;
      const text = version.subarray(0, size[0]).toString("utf16le").replace(/\0+$/, "");
      if (/^\d+\.\d+\.\d+\.\d+$/.test(text) && text.split(".").some((part) => Number(part) > 0)) return true;
    }
    return false;
  } finally {
    registry.close();
  }
}

export function ensureWebView2Runtime(): boolean {
  if (process.platform !== "win32") throw new Error("鸣潮助手目前仅支持 Windows。");
  if (hasWebView2Runtime()) return true;
  if (confirmStartupAction("需要安装 WebView2", "鸣潮助手需要 Microsoft Edge WebView2 Runtime 才能显示界面。\n\n是否打开微软官方下载页？安装 Evergreen（常青版）运行时后，请重新启动助手。")) {
    openWithSystem(downloadPage);
  }
  return false;
}
