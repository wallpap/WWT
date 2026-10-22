import { dlopen, FFIType, JSCallback, ptr, type Pointer } from "bun:ffi";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AppSettings } from "../app/settings.ts";
import { parseShortcut } from "../app/shortcut.ts";

const windowsMessage = {
  close: 0x0010,
  setIcon: 0x0080,
  hotkey: 0x0312,
  trayCallback: 0x802a,
  leftButtonDoubleClick: 0x0203,
  rightButtonUp: 0x0205,
  nullMessage: 0,
} as const;
const windowLongIndexProcedure = -4;
const trayOwnerExtendedStyle = 0x08000080;
const trayOwnerWindowStyle = 0x80000000;
const showWindowCommand = { hide: 0, restore: 9 } as const;
const shellNotifyCommand = { add: 0, delete: 2 } as const;
const hotkeyId = { first: 1, second: 2 } as const;
const menuCommand = { showWindow: 1, exit: 2 } as const;
const notifyIconFlag = { message: 0x0001, icon: 0x0002, tip: 0x0004 } as const;
const notifyIconFlags = notifyIconFlag.message | notifyIconFlag.icon | notifyIconFlag.tip;
const notifyIconDataSize = 976;
const notifyIconFieldOffset = { structureSize: 0, window: 8, id: 16, flags: 20, callbackMessage: 24, icon: 32, tip: 40 } as const;
const notifyIconId = 1;
const iconHandleBufferSize = 8;
const iconHandleOffset = 0;
const pointBufferSize = 8;
const pointFieldOffset = { x: 0, y: 4 } as const;
const trayOwnerGeometry = { x: 0, y: 0, width: 0, height: 0 } as const;
const applicationIconIndex = 0;
const applicationIconCount = 1;
const menuItemStringFlags = 0;
const popupMenuTrackingFlags = 0x0102;
const popupMenuReservedParameter = 0;
const applicationIconResourceId = 32512n;
const iconType = { small: 0n, large: 1n } as const;
const hotkeyNoSelection = 0;
const successResult = 0;

function loadUser32() {
  return dlopen("user32.dll", {
    SetWindowLongPtrW: {
      args: [FFIType.ptr, FFIType.i32, FFIType.ptr],
      returns: FFIType.ptr,
    },
    CallWindowProcW: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64],
      returns: FFIType.i64,
    },
    DefWindowProcW: {
      args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64],
      returns: FFIType.i64,
    },
    ShowWindow: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    IsWindow: { args: [FFIType.ptr], returns: FFIType.i32 },
    IsWindowVisible: { args: [FFIType.ptr], returns: FFIType.i32 },
    SetForegroundWindow: { args: [FFIType.ptr], returns: FFIType.i32 },
    LoadIconW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    SendMessageW: {
      args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64],
      returns: FFIType.i64,
    },
    DestroyIcon: { args: [FFIType.ptr], returns: FFIType.i32 },
    RegisterHotKey: {
      args: [FFIType.ptr, FFIType.i32, FFIType.u32, FFIType.u32],
      returns: FFIType.i32,
    },
    UnregisterHotKey: {
      args: [FFIType.ptr, FFIType.i32],
      returns: FFIType.i32,
    },
    RegisterWindowMessageW: { args: [FFIType.ptr], returns: FFIType.u32 },
    CreatePopupMenu: { args: [], returns: FFIType.ptr },
    AppendMenuW: {
      args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.ptr],
      returns: FFIType.i32,
    },
    GetCursorPos: { args: [FFIType.ptr], returns: FFIType.i32 },
    TrackPopupMenu: {
      args: [FFIType.ptr, FFIType.u32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.ptr],
      returns: FFIType.u32,
    },
    CreateWindowExW: {
      args: [FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.ptr,
    },
    DestroyWindow: { args: [FFIType.ptr], returns: FFIType.i32 },
    PostMessageW: {
      args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64],
      returns: FFIType.i32,
    },
    DestroyMenu: { args: [FFIType.ptr], returns: FFIType.i32 },
  });
}

export class DesktopWindow {
  #user = loadUser32();
  #shell = dlopen("shell32.dll", {
    Shell_NotifyIconW: {
      args: [FFIType.u32, FFIType.ptr],
      returns: FFIType.i32,
    },
    ExtractIconExW: {
      args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.ptr, FFIType.u32],
      returns: FFIType.u32,
    },
  });
  #icon = Buffer.alloc(notifyIconDataSize);
  #windowIconLarge: bigint | null = null;
  #windowIconSmall: bigint | null = null;
  #callback: JSCallback;
  #previous: Pointer | bigint | null = null;
  #hotkey = hotkeyNoSelection;
  #shortcut = "";
  #closeAction: AppSettings["closeAction"] = "exit";
  #disposed = false;
  #trayAvailable = false;
  #taskbarCreated = 0;
  #menuOwner: Pointer | bigint | null = null;
  get trayAvailable(): boolean {
    return this.#trayAvailable;
  }
  notice: string | null = null;

  constructor(
    private readonly window: Pointer | bigint,
    settings: Pick<AppSettings, "closeAction" | "showShortcut">,
    private readonly exit: () => void,
    private readonly onError: (message: string) => void,
  ) {
    this.#callback = new JSCallback(
      (hwnd: Pointer, message: number, wparam: bigint, lparam: bigint) => {
        try {
          if (this.#taskbarCreated && message === this.#taskbarCreated) {
            this.#trayAvailable = Boolean(this.#shell.symbols.Shell_NotifyIconW(shellNotifyCommand.add, ptr(this.#icon)));
            if (!this.#trayAvailable) {
              this.show();
              this.notice = "系统托盘恢复失败，已显示主窗口";
              this.onError(this.notice);
            }
            return successResult;
          }
          if (message === windowsMessage.close) {
            if (this.#closeAction === "tray") this.hide();
            else this.exit();
            return successResult;
          }
          if (message === windowsMessage.hotkey && Number(wparam) === this.#hotkey) {
            if (this.#user.symbols.IsWindowVisible(window)) this.hide();
            else this.show();
            return successResult;
          }
          if (message === windowsMessage.trayCallback) {
            if (Number(lparam) === windowsMessage.leftButtonDoubleClick) this.show();
            else if (Number(lparam) === windowsMessage.rightButtonUp) this.#menu();
            return successResult;
          }
        } catch (error) {
          this.onError(error instanceof Error ? error.message : "桌面操作失败");
          return successResult;
        }
        return this.#previous ? this.#user.symbols.CallWindowProcW(this.#previous, hwnd, message, wparam, lparam) : this.#user.symbols.DefWindowProcW(hwnd, message, wparam, lparam);
      },
      {
        args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64],
        returns: FFIType.i64,
      },
    );
    if (!this.#callback.ptr) {
      this.#callback.close();
      this.#user.close();
      this.#shell.close();
      throw new Error("桌面窗口回调不可用");
    }
    this.#previous = this.#user.symbols.SetWindowLongPtrW(window, windowLongIndexProcedure, this.#callback.ptr);
    if (!this.#previous) {
      this.#callback.close();
      this.#user.close();
      this.#shell.close();
      throw new Error("无法接入桌面窗口消息");
    }
    const ownerClass = Buffer.from("STATIC\0", "utf16le");
    this.#menuOwner = this.#user.symbols.CreateWindowExW(trayOwnerExtendedStyle, ptr(ownerClass), null, trayOwnerWindowStyle, trayOwnerGeometry.x, trayOwnerGeometry.y, trayOwnerGeometry.width, trayOwnerGeometry.height, null, null, null, null);
    this.#icon.writeUInt32LE(this.#icon.length, notifyIconFieldOffset.structureSize);
    this.#icon.writeBigUInt64LE(BigInt(window), notifyIconFieldOffset.window);
    this.#icon.writeUInt32LE(notifyIconId, notifyIconFieldOffset.id);
    this.#icon.writeUInt32LE(notifyIconFlags, notifyIconFieldOffset.flags);
    this.#icon.writeUInt32LE(windowsMessage.trayCallback, notifyIconFieldOffset.callbackMessage);
    const localIcon = join(import.meta.dir, "../assets/carlotta.ico");
    const iconSource = Buffer.from(`${existsSync(localIcon) ? localIcon : process.execPath}\0`, "utf16le");
    const largeBuffer = Buffer.alloc(iconHandleBufferSize),
      smallBuffer = Buffer.alloc(iconHandleBufferSize);
    const extracted = this.#shell.symbols.ExtractIconExW(ptr(iconSource), applicationIconIndex, ptr(largeBuffer), ptr(smallBuffer), applicationIconCount);
    const large = extracted ? largeBuffer.readBigUInt64LE(iconHandleOffset) : iconType.small;
    const small = extracted ? smallBuffer.readBigUInt64LE(iconHandleOffset) : iconType.small;
    if (large) {
      this.#windowIconLarge = large;
      this.#user.symbols.SendMessageW(window, windowsMessage.setIcon, iconType.large, large);
    }
    if (small) {
      this.#windowIconSmall = small;
      this.#user.symbols.SendMessageW(window, windowsMessage.setIcon, iconType.small, small);
    }
    const icon = small || large || this.#user.symbols.LoadIconW(null, applicationIconResourceId);
    if (icon) this.#icon.writeBigUInt64LE(BigInt(icon), notifyIconFieldOffset.icon);
    Buffer.from("鸣潮助手\0", "utf16le").copy(this.#icon, notifyIconFieldOffset.tip);
    const taskbarMessage = Buffer.from("TaskbarCreated\0", "utf16le");
    this.#taskbarCreated = this.#user.symbols.RegisterWindowMessageW(ptr(taskbarMessage));
    this.#trayAvailable = Boolean(this.#shell.symbols.Shell_NotifyIconW(shellNotifyCommand.add, ptr(this.#icon)));
    try {
      this.configure(settings);
    } catch (error) {
      this.#closeAction = settings.closeAction;
      this.notice = error instanceof Error ? error.message : "桌面偏好未能应用";
    }
  }

  configure(settings: Pick<AppSettings, "closeAction" | "showShortcut">): void {
    if (settings.closeAction === "tray" && !this.trayAvailable) throw new Error("系统托盘不可用，请保持窗口显示");
    const shortcut = parseShortcut(settings.showShortcut);
    if ((shortcut?.text ?? "") !== this.#shortcut) {
      const next = this.#hotkey === hotkeyId.first ? hotkeyId.second : hotkeyId.first;
      if (shortcut && !this.#user.symbols.RegisterHotKey(this.window, next, shortcut.modifiers, shortcut.key)) throw new Error("快捷键已被占用，请更换组合");
      if (this.#hotkey) this.#user.symbols.UnregisterHotKey(this.window, this.#hotkey);
      this.#hotkey = shortcut ? next : hotkeyNoSelection;
      this.#shortcut = shortcut?.text ?? "";
    }
    this.#closeAction = settings.closeAction;
    this.notice = null;
  }
  show(): void {
    this.#user.symbols.ShowWindow(this.window, showWindowCommand.restore);
    this.#user.symbols.SetForegroundWindow(this.window);
  }
  hide(): void {
    if (!this.trayAvailable) throw new Error("系统托盘不可用，请保持窗口显示");
    this.#user.symbols.ShowWindow(this.window, showWindowCommand.hide);
  }
  #menu(): void {
    if (!this.#menuOwner) throw new Error("托盘菜单窗口不可用");
    const menu = this.#user.symbols.CreatePopupMenu();
    if (!menu) return;
    const show = Buffer.from("显示主窗口\0", "utf16le"),
      exit = Buffer.from("退出鸣潮助手\0", "utf16le"),
      position = Buffer.alloc(pointBufferSize);
    try {
      this.#user.symbols.AppendMenuW(menu, menuItemStringFlags, menuCommand.showWindow, ptr(show));
      this.#user.symbols.AppendMenuW(menu, menuItemStringFlags, menuCommand.exit, ptr(exit));
      this.#user.symbols.GetCursorPos(ptr(position));
      this.#user.symbols.SetForegroundWindow(this.#menuOwner);
      const action = this.#user.symbols.TrackPopupMenu(menu, popupMenuTrackingFlags, position.readInt32LE(pointFieldOffset.x), position.readInt32LE(pointFieldOffset.y), popupMenuReservedParameter, this.#menuOwner, null);
      this.#user.symbols.PostMessageW(this.#menuOwner, windowsMessage.nullMessage, 0n, 0n);
      if (action === menuCommand.showWindow) this.show();
      else if (action === menuCommand.exit) this.exit();
    } finally {
      this.#user.symbols.DestroyMenu(menu);
    }
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#hotkey) this.#user.symbols.UnregisterHotKey(this.window, this.#hotkey);
    if (this.trayAvailable) this.#shell.symbols.Shell_NotifyIconW(shellNotifyCommand.delete, ptr(this.#icon));
    if (this.#previous && this.#user.symbols.IsWindow(this.window)) this.#user.symbols.SetWindowLongPtrW(this.window, windowLongIndexProcedure, this.#previous);
    if (this.#menuOwner) this.#user.symbols.DestroyWindow(this.#menuOwner);
    if (this.#windowIconSmall) this.#user.symbols.DestroyIcon(this.#windowIconSmall);
    if (this.#windowIconLarge && this.#windowIconLarge !== this.#windowIconSmall) this.#user.symbols.DestroyIcon(this.#windowIconLarge);
    this.#callback.close();
    this.#shell.close();
    this.#user.close();
  }
}
