export async function setWindowsStartup(enabled: boolean): Promise<void> {
  if (!Bun.isStandaloneExecutable) throw new Error("登录启动设置需在便携版中修改");
  const script = `
$ErrorActionPreference = 'Stop'
$key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
if ($env:WWT_STARTUP_ENABLED -eq '1') {
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -LiteralPath $key -Name 'WWT.Bun' -Value $env:WWT_STARTUP_COMMAND
} else {
  if (Get-ItemProperty -LiteralPath $key -Name 'WWT.Bun' -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -LiteralPath $key -Name 'WWT.Bun'
  }
}
`;
  const child = Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    env: {
      ...process.env,
      WWT_STARTUP_ENABLED: enabled ? "1" : "0",
      WWT_STARTUP_COMMAND: `"${process.execPath}" --startup`,
    },
    stdout: "ignore",
    stderr: "ignore",
    windowsHide: true,
  });
  if ((await child.exited) !== 0) throw new Error("修改 Windows 登录启动失败");
}
