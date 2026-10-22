const maxClipboardTextLength = 1_048_576;

export async function copyText(text: string): Promise<void> {
  if (typeof text !== "string" || text.length > maxClipboardTextLength) throw new Error("复制内容无效");
  const child = Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-STA", "-WindowStyle", "Hidden", "-Command", "Add-Type -AssemblyName System.Windows.Forms; [Console]::InputEncoding = [System.Text.Encoding]::UTF8; $text = [Console]::In.ReadToEnd(); if ($text.Length) { [System.Windows.Forms.Clipboard]::SetText($text) } else { [System.Windows.Forms.Clipboard]::Clear() }"], { stdin: "pipe", stdout: "ignore", stderr: "ignore", windowsHide: true });
  child.stdin.write(text);
  child.stdin.end();
  if ((await child.exited) !== 0) throw new Error("写入剪贴板失败");
}
