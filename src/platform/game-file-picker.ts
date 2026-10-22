import { validateGameExecutable } from "../game/launcher.ts";
import type { MigrationSource } from "../migration/read.ts";
import { join } from "node:path";

async function pickFile(title: string, filter: string, fileName: string): Promise<string | null> {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = '${title.replaceAll("'", "''")}'
$dialog.Filter = '${filter.replaceAll("'", "''")}'
$dialog.FileName = '${fileName.replaceAll("'", "''")}'
try {
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::Write($dialog.FileName)
  }
} finally { $dialog.Dispose() }
`;
  return runDialog(script);
}

async function runDialog(script: string): Promise<string | null> {
  const child = Bun.spawn(["powershell.exe", "-NoProfile", "-STA", "-WindowStyle", "Hidden", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { stdout: "pipe", stderr: "pipe", windowsHide: true });
  const [output, error, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(`打开文件选择器失败：${error.trim()}`);
  const path = output.replace(/^\uFEFF/, "").trim();
  return path || null;
}

export async function pickGameExecutable(): Promise<string | null> {
  const path = await pickFile("选择鸣潮游戏主程序", "游戏程序 (*.exe)|*.exe", "WutheringWaves.exe");
  return path ? validateGameExecutable(path) : null;
}

export async function pickGameInstallDirectory(): Promise<string | null> {
  const directory = await runDialog(`
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择独立的鸣潮安装目录'
$dialog.ShowNewFolderButton = $true
try {
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::Write($dialog.SelectedPath)
  }
} finally { $dialog.Dispose() }
`);
  return directory ? join(directory, "Wuthering Waves.exe") : null;
}

export async function pickGachaLogFile(): Promise<string | null> {
  return pickFile("选择鸣潮 Client.log", "日志文件 (*.log)|*.log|所有文件 (*.*)|*.*", "Client.log");
}

export async function pickMigrationSource(source: MigrationSource): Promise<string | null> {
  if (source === "xlsx") return pickFile("选择原版抽卡 XLSX", "抽卡表格 (*.xlsx)|*.xlsx", "");
  if (source === "java-sqlite" || source === "java-accounts") return pickFile("选择原版 SQLite 数据库", "SQLite 数据库 (*.db;*.sqlite;*.sqlite3)|*.db;*.sqlite;*.sqlite3|所有文件 (*.*)|*.*", "sqlite.db");
  if (source === "java-settings") return pickFile("选择原版设置文件", "原版设置 (settings.json)|settings.json|JSON 文件 (*.json)|*.json", "settings.json");
  throw new Error("迁移来源类型无效");
}
