const gameProcessProbeTimeoutMs = 5_000;

export async function isGameProcessRunning(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const child = Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", "$ErrorActionPreference = 'Stop'; if (Get-Process -Name 'Client-Win64-Shipping' -ErrorAction SilentlyContinue) { 'running' } else { 'stopped' }"], { stdout: "pipe", stderr: "ignore", windowsHide: true });
  const timer = setTimeout(() => child.kill(), gameProcessProbeTimeoutMs);
  try {
    const output = (await new Response(child.stdout).text()).trim();
    if ((await child.exited) !== 0 || !["running", "stopped"].includes(output)) throw new Error("读取游戏运行状态失败，请稍后重试");
    return output === "running";
  } finally {
    clearTimeout(timer);
  }
}
