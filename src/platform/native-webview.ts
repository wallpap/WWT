import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { dlopen, FFIType, ptr, type Pointer } from "bun:ffi";
import { WindowBridge } from "./window-bridge.ts";
import { runWindowsMessageLoop } from "./windows-message-loop.ts";

type NativeHandle = Pointer | bigint;
type NativeLibrary = ReturnType<typeof loadNativeLibrary>;

const sizeHint = {
  none: 0,
} as const;

function cString(value: string): Pointer {
  return ptr(new TextEncoder().encode(`${value}\0`));
}

function resolveLibraryPath(): string {
  if (process.platform !== "win32") {
    throw new Error("鸣潮助手目前仅支持 Windows。");
  }

  const path = Bun.isStandaloneExecutable ? join(dirname(process.execPath), "libwebview.dll") : resolve(import.meta.dir, "../../node_modules/webview-bun/build/libwebview.dll");

  if (!existsSync(path)) {
    throw new Error(`缺少 WebView 原生组件：${path}`);
  }
  return path;
}

function loadNativeLibrary() {
  const libraryPath = resolveLibraryPath();
  try {
    return dlopen(libraryPath, {
      webview_create: {
        args: [FFIType.i32, FFIType.ptr],
        returns: FFIType.ptr,
      },
      webview_destroy: {
        args: [FFIType.ptr],
        returns: FFIType.void,
      },
      webview_get_window: { args: [FFIType.ptr], returns: FFIType.ptr },
      webview_terminate: {
        args: [FFIType.ptr],
        returns: FFIType.void,
      },
      webview_set_title: {
        args: [FFIType.ptr, FFIType.ptr],
        returns: FFIType.void,
      },
      webview_set_size: {
        args: [FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.i32],
        returns: FFIType.void,
      },
      webview_set_html: {
        args: [FFIType.ptr, FFIType.ptr],
        returns: FFIType.void,
      },
      webview_navigate: {
        args: [FFIType.ptr, FFIType.ptr],
        returns: FFIType.void,
      },
      webview_init: {
        args: [FFIType.ptr, FFIType.ptr],
        returns: FFIType.void,
      },
    });
  } catch (error) {
    const suggestion = Bun.isStandaloneExecutable ? "请重新解压完整便携包，保留原来的 data 文件夹" : "请确认已安装 Microsoft Visual C++ x64 运行库";
    throw new Error(`无法加载 WebView 原生组件，${suggestion}：${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

export class NativeWebview {
  readonly #library: NativeLibrary;
  readonly #handle: NativeHandle;
  readonly #bridge: WindowBridge;
  #bindingsReady = false;
  #destroyed = false;
  #failure: Error | null = null;

  constructor(title: string, width: number, height: number) {
    this.#library = loadNativeLibrary();
    const handle = this.#library.symbols.webview_create(0, null);
    if (handle === null || handle === 0 || handle === 0n) {
      this.#library.close();
      throw new Error("无法创建桌面窗口。请确认已安装 Microsoft Edge WebView2 Runtime。");
    }

    this.#handle = handle;
    try {
      this.#bridge = new WindowBridge();
    } catch (error) {
      this.#library.symbols.webview_destroy(handle);
      this.#library.close();
      throw error;
    }
    this.#library.symbols.webview_set_title(this.#handle, cString(title));
    this.#library.symbols.webview_set_size(this.#handle, width, height, sizeHint.none);
  }

  setHtml(html: string): void {
    this.#queue(() => {
      this.#installBindings();
      this.#library.symbols.webview_set_html(this.#handle, cString(html));
    });
  }

  navigate(url: string): void {
    this.#queue(() => {
      this.#installBindings();
      this.#library.symbols.webview_navigate(this.#handle, cString(url));
    });
  }

  get windowHandle(): Pointer | bigint {
    const handle = this.#library.symbols.webview_get_window(this.#handle);
    if (!handle) throw new Error("主窗口句柄不可用");
    return handle;
  }

  evaluate(script: string): void {
    this.#bridge.evaluate(script);
  }

  bind<Arguments extends unknown[]>(name: string, handler: (...args: Arguments) => unknown): void {
    this.#bridge.bind(name, handler);
    if (this.#bindingsReady) {
      this.#bindingsReady = false;
      this.#queue(() => {
        this.#installBindings();
        this.#bridge.evaluate(this.#bridge.bootstrapScript());
      });
    }
  }

  #queue(action: () => void): void {
    setImmediate(() => {
      if (this.#destroyed) return;
      try {
        action();
      } catch (error) {
        this.#failure = error instanceof Error ? error : new Error(String(error));
        this.terminate();
      }
    });
  }

  #installBindings(): void {
    if (this.#bindingsReady) return;
    this.#bindingsReady = true;
    this.#library.symbols.webview_init(this.#handle, cString(this.#bridge.bootstrapScript()));
  }

  async run(): Promise<void> {
    if (this.#destroyed) return;
    try {
      await runWindowsMessageLoop(() => this.#destroyed);
      if (this.#failure) throw this.#failure;
    } finally {
      this.destroy();
    }
  }

  terminate(): void {
    if (!this.#destroyed) this.#library.symbols.webview_terminate(this.#handle);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;

    this.#bridge.close();
    this.#library.symbols.webview_destroy(this.#handle);
    this.#library.close();
  }
}
