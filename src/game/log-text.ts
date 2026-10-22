const gameLogXorKey = {
  oddByte: 0xa5,
  evenByte: 0xef,
  parityMask: 0x01,
  oddParity: 0x01,
} as const;

export function decryptGameLog(bytes: Uint8Array): string {
  const decoded = Uint8Array.from(bytes, (value) => ((value & gameLogXorKey.parityMask) === gameLogXorKey.oddParity ? value ^ gameLogXorKey.oddByte : value ^ gameLogXorKey.evenByte));
  return new TextDecoder().decode(decoded);
}

export function decodeGameLog(bytes: Uint8Array): string {
  const plain = new TextDecoder().decode(bytes);
  return /\[\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}:\d{3}\]/.test(plain) ? plain : decryptGameLog(bytes);
}
