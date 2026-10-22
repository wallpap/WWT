export function compareResourceVersions(left: string, right: string): number {
  if (!/^\d+(?:\.\d+)*$/.test(left) || !/^\d+(?:\.\d+)*$/.test(right)) throw new Error("游戏版本号无效");
  const a = left.split(".").map(BigInt),
    b = right.split(".").map(BigInt);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const x = a[index] ?? 0n,
      y = b[index] ?? 0n;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}
