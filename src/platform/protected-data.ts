import { dlopen, FFIType, ptr, toArrayBuffer } from "bun:ffi";

const cryptDataFlags = 1;
const pointerFieldOffset = 8;
const dataBlobSize = 16;

export function protectLocalData(data: Uint8Array, decrypt = false): Uint8Array {
  const crypt = dlopen("Crypt32.dll", {
    CryptProtectData: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr],
      returns: FFIType.i32,
    },
    CryptUnprotectData: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr],
      returns: FFIType.i32,
    },
  });
  const kernel = dlopen("Kernel32.dll", {
    LocalFree: { args: [FFIType.ptr], returns: FFIType.ptr },
  });
  const input = Buffer.alloc(dataBlobSize);
  input.writeUInt32LE(data.byteLength);
  input.writeBigUInt64LE(BigInt(ptr(data)), pointerFieldOffset);
  const output = Buffer.alloc(dataBlobSize);
  try {
    const operation = decrypt ? crypt.symbols.CryptUnprotectData : crypt.symbols.CryptProtectData;
    if (!operation(ptr(input), null, null, null, null, cryptDataFlags, ptr(output))) throw new Error("无法读写本机加密会话，请使用原 Windows 账号重试");
    const address = Number(output.readBigUInt64LE(pointerFieldOffset));
    try {
      return new Uint8Array(toArrayBuffer(address, 0, output.readUInt32LE(0))).slice();
    } finally {
      kernel.symbols.LocalFree(BigInt(address));
    }
  } finally {
    crypt.close();
    kernel.close();
  }
}
