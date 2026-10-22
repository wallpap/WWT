import { dlopen, FFIType, ptr } from "bun:ffi";

const messageBoxErrorIcon = 0x10;

function wideString(value: string) {
  const buffer = new Uint16Array(value.length + 1);
  for (let index = 0; index < value.length; index += 1) {
    buffer[index] = value.charCodeAt(index);
  }
  return ptr(buffer);
}

function messageBox(title: string, message: string, flags: number): number {
  const user32 = dlopen("user32.dll", {
    MessageBoxW: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32],
      returns: FFIType.i32,
    },
  });
  try {
    return user32.symbols.MessageBoxW(null, wideString(message), wideString(title), flags);
  } finally {
    user32.close();
  }
}

export function showStartupError(title: string, message: string): void {
  if (process.platform !== "win32") return;
  try {
    messageBox(title, message, messageBoxErrorIcon);
  } catch {
    process.stderr.write(`${title}\n${message}\n`);
  }
}

export function confirmStartupAction(title: string, message: string): boolean {
  // MB_YESNO | MB_ICONINFORMATION，IDYES = 6。
  return messageBox(title, message, 0x04 | 0x40) === 6;
}
