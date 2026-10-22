const virtualKey = {
  none: 0,
  functionKeyBase: 0x6f,
} as const;
const modifierFlag = {
  ctrl: 0x0002,
  alt: 0x0001,
  shift: 0x0004,
  windows: 0x0008,
} as const;
const hotkeyNoRepeatFlag = 0x4000;

export function parseShortcut(value: string): { text: string; modifiers: number; key: number } | null {
  if (!value.trim()) return null;
  const parts = value.split("+").map((part) => part.trim().toUpperCase());
  const key = parts.pop()!;
  const modifiers = new Set(parts);
  if (modifiers.size !== parts.length || parts.some((part) => !["CTRL", "ALT", "SHIFT", "WIN"].includes(part)) || !parts.length || !parts.some((part) => ["CTRL", "ALT", "WIN"].includes(part))) throw new Error("快捷键需包含 Ctrl、Alt 或 Win，例如 Ctrl+Alt+W");
  const vk = /^[A-Z0-9]$/.test(key) ? key.charCodeAt(0) : /^F(?:[1-9]|1\d|2[0-4])$/.test(key) ? virtualKey.functionKeyBase + Number(key.slice(1)) : virtualKey.none;
  if (!vk) throw new Error("快捷键主键支持字母、数字或 F1—F24");
  const labels = [
    ["CTRL", "Ctrl", modifierFlag.ctrl],
    ["ALT", "Alt", modifierFlag.alt],
    ["SHIFT", "Shift", modifierFlag.shift],
    ["WIN", "Win", modifierFlag.windows],
  ] as const;
  return {
    text: [...labels.filter(([name]) => modifiers.has(name)).map(([, label]) => label), key].join("+"),
    modifiers: labels.reduce((sum, [name, , flag]) => sum + (modifiers.has(name) ? flag : 0), 0) | hotkeyNoRepeatFlag,
    key: vk,
  };
}
