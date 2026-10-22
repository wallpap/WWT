import { dlopen, FFIType, ptr } from "bun:ffi";

const windowsMessage = { quit: 0x0012 } as const;
const windowsMessageBufferSize = 48;
const messageFieldOffset = 8;
const messagesPerBatchLimit = 128;
const messageBatchBudgetMs = 4;
const removeMessageFlag = 1;
const messageLoopPollIntervalMs = 8;

export async function runWindowsMessageLoop(isDestroyed: () => boolean): Promise<void> {
  const user32 = dlopen("user32.dll", {
    PeekMessageW: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32],
      returns: FFIType.i32,
    },
    TranslateMessage: { args: [FFIType.ptr], returns: FFIType.i32 },
    DispatchMessageW: { args: [FFIType.ptr], returns: FFIType.i64 },
  });
  // Win64 MSG 的 HWND 占 8 字节，message 位于偏移 8；完整结构为 48 字节。
  const message = new Uint8Array(windowsMessageBufferSize);
  const data = new DataView(message.buffer);
  const address = ptr(message);
  try {
    if (isDestroyed()) return;
    await new Promise<void>((resolve, reject) => {
      // 从定时器任务分发原生消息，避免在 Promise 任务中重入 WebView 回调时阻塞启动。
      const timer = setInterval(() => {
        try {
          const started = performance.now();
          // 限制每批消息数，让 Bun 继续处理 I/O、Promise 和进程退出通知。
          for (let count = 0; count < messagesPerBatchLimit && !isDestroyed(); count += 1) {
            if (!user32.symbols.PeekMessageW(address, null, 0, 0, removeMessageFlag)) break;
            if (data.getUint32(messageFieldOffset, true) === windowsMessage.quit) {
              clearInterval(timer);
              resolve();
              return;
            }
            user32.symbols.TranslateMessage(address);
            user32.symbols.DispatchMessageW(address);
            if (performance.now() - started >= messageBatchBudgetMs) break;
          }
          if (isDestroyed()) {
            clearInterval(timer);
            resolve();
          }
        } catch (error) {
          clearInterval(timer);
          reject(error);
        }
      }, messageLoopPollIntervalMs);
    });
  } finally {
    user32.close();
  }
}
