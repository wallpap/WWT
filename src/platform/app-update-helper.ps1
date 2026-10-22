$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression

function Get-Sha256([string]$path) {
  $stream = [IO.File]::OpenRead($path)
  $hash = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $hash.Dispose(); $stream.Dispose() }
}

function Get-SafeRelative([string]$value) {
  $path = $value.Replace('\', '/').TrimEnd('/')
  if (-not $path -or $path.StartsWith('/')) { throw 'Invalid package path' }
  foreach ($part in $path.Split('/')) {
    if (-not $part -or $part -eq '.' -or $part -eq '..' -or $part -match '[<>:"|?*\x00-\x1f]' -or $part -match '[. ]$' -or $part -match '^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)') { throw 'Invalid package path' }
  }
  $packageFiles = @('WWT.exe', 'libwebview.dll', 'hpatchz.exe', 'carlotta.png', 'msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'LICENSE', 'README.txt', 'README.md', 'ACKNOWLEDGMENTS.md', 'docs/README.md', 'docs/usage.md', 'docs/migration.md', 'docs/data-storage.md', 'docs/resource-updates.md')
  if ($path -notin $packageFiles -and $path -ne 'docs' -and -not $path.StartsWith('THIRD-PARTY-NOTICES/', [StringComparison]::OrdinalIgnoreCase) -and $path -ne 'THIRD-PARTY-NOTICES') { throw 'Unsupported package file' }
  return $path
}

function Assert-NoLinks([string]$path) {
  $current = [IO.Path]::GetFullPath($path)
  while ($current) {
    if (Test-Path -LiteralPath $current) {
      if ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked update path' }
    }
    $parent = [IO.Path]::GetDirectoryName($current)
    if ($parent -eq $current) { break }
    $current = $parent
  }
}

function Write-UpdateJson([string]$path, $value) {
  $temporary = $path + '.tmp'
  [IO.File]::WriteAllText($temporary, ($value | ConvertTo-Json -Depth 6))
  if ([IO.File]::Exists($path)) { [IO.File]::Replace($temporary, $path, [NullString]::Value) }
  else { [IO.File]::Move($temporary, $path) }
}

function Restore-AppPackage($plan, [string]$workspace) {
  $workspace = [IO.Path]::GetFullPath($workspace.Replace('/', '\'))
  $root = [IO.Path]::GetFullPath($plan.root.Replace('/', '\'))
  if ([IO.Path]::GetDirectoryName($workspace) -ne $root -or -not [IO.Path]::GetFileName($workspace).StartsWith('.wwt-app-update-')) { throw 'Invalid recovery workspace' }
  $journalPath = Join-Path $workspace 'journal.json'
  if (-not (Test-Path -LiteralPath $journalPath -PathType Leaf)) { return }
  Assert-NoLinks $journalPath
  $journal = [IO.File]::ReadAllText($journalPath) | ConvertFrom-Json
  if ($journal.phase -in @('committed', 'rolled-back')) { return }
  if ($journal.phase -ne 'installing') { throw 'Invalid recovery phase' }
  $entries = @($journal.entries)
  [array]::Reverse($entries)
  foreach ($entry in $entries) {
    $relative = Get-SafeRelative $entry.path
    $target = Join-Path $root $relative
    $old = Join-Path (Join-Path $workspace 'backup') $relative
    Assert-NoLinks $target
    Assert-NoLinks $old
    if (Test-Path -LiteralPath $old -PathType Leaf) {
      if (Test-Path -LiteralPath $target -PathType Leaf) { [IO.File]::Delete($target) }
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
      [IO.File]::Move($old, $target)
    } elseif (-not $entry.hadOriginal -and (Test-Path -LiteralPath $target -PathType Leaf)) { [IO.File]::Delete($target) }
  }
  Write-UpdateJson $journalPath @{ phase = 'rolled-back'; entries = $journal.entries }
}

function Install-AppPackage($plan, [string]$workspace) {
  $root = [IO.Path]::GetFullPath($plan.root.Replace('/', '\'))
  $staging = Join-Path $workspace 'package'
  $backup = Join-Path $workspace 'backup'
  $journal = Join-Path $workspace 'journal.json'
  $changes = @()
  try {
    foreach ($file in ($plan.files | Sort-Object @{ Expression = { $_.path -eq 'WWT.exe' } }, path)) {
      $relative = Get-SafeRelative $file.path
      $source = Join-Path $staging $relative
      $target = Join-Path $root $relative
      $old = Join-Path $backup $relative
      Assert-NoLinks $source
      Assert-NoLinks $target
      Assert-NoLinks $old
      if ((Get-Sha256 $source) -ne $file.sha256) { throw 'Staged file checksum failed' }
      $hadOriginal = Test-Path -LiteralPath $target
      if ($hadOriginal -and -not (Test-Path -LiteralPath $target -PathType Leaf)) { throw 'Update target is not a file' }
      $changes += [pscustomobject]@{ path = $relative; hadOriginal = $hadOriginal }
      Write-UpdateJson $journal @{ phase = 'installing'; entries = $changes }
      if ($hadOriginal) { [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($old)) | Out-Null; [IO.File]::Move($target, $old) }
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
      [IO.File]::Move($source, $target)
    }
    Write-UpdateJson $journal @{ phase = 'committed'; entries = $changes }
  } catch {
    $message = $_.Exception.Message
    try {
      [array]::Reverse($changes)
      foreach ($change in $changes) {
        $target = Join-Path $root $change.path
        $old = Join-Path $backup $change.path
        Assert-NoLinks $target
        Assert-NoLinks $old
        if (Test-Path -LiteralPath $old -PathType Leaf) {
          if (Test-Path -LiteralPath $target -PathType Leaf) { [IO.File]::Delete($target) }
          [IO.File]::Move($old, $target)
        } elseif (-not $change.hadOriginal -and (Test-Path -LiteralPath $target -PathType Leaf)) { [IO.File]::Delete($target) }
      }
      Write-UpdateJson $journal @{ phase = 'rolled-back'; entries = $changes }
    } catch { $message += '; rollback failed: ' + $_.Exception.Message }
    throw $message
  }
}

# 点引用供文件事务回归测试调用，不进入进程等待或重启流程。
if ($MyInvocation.InvocationName -eq '.') { return }

if ($env:WWT_UPDATE_MODE -eq 'extract') {
  $archivePath = [IO.Path]::GetFullPath($env:WWT_UPDATE_ARCHIVE)
  $staging = [IO.Path]::GetFullPath($env:WWT_UPDATE_STAGING)
  Assert-NoLinks $archivePath
  Assert-NoLinks $staging
  if ((Test-Path -LiteralPath $staging) -and @(Get-ChildItem -LiteralPath $staging -Force).Count) { throw 'Staging is not empty' }
  $zip = [IO.Compression.ZipFile]::OpenRead($archivePath)
  try {
    $files = @()
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    [long]$total = 0
    foreach ($entry in $zip.Entries) {
      $name = $entry.FullName.Replace('\', '/')
      $prefix = $env:WWT_UPDATE_FOLDER + '/'
      if ($name -eq $prefix) { continue }
      if (-not $name.StartsWith($prefix, [StringComparison]::Ordinal)) { throw 'Unexpected package root' }
      $relative = Get-SafeRelative $name.Substring($prefix.Length)
      if (($entry.ExternalAttributes -shr 16 -band 0xF000) -eq 0xA000) { throw 'Package contains links' }
      if ($name.EndsWith('/')) { continue }
      if (-not $seen.Add($relative)) { throw 'Duplicate package entry' }
      $total += $entry.Length
      if ($seen.Count -gt 2000 -or $total -gt 1073741824) { throw 'Package exceeds size limit' }
      $files += [pscustomobject]@{ path = $relative; entry = $entry }
    }
    foreach ($required in @('WWT.exe', 'libwebview.dll', 'hpatchz.exe', 'carlotta.png', 'msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'LICENSE', 'README.txt')) { if (-not $seen.Contains($required)) { throw 'Incomplete portable package' } }
    [IO.Directory]::CreateDirectory($staging) | Out-Null
    $result = @()
    foreach ($file in $files) {
      $target = [IO.Path]::GetFullPath((Join-Path $staging $file.path))
      if (-not $target.StartsWith($staging.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Package path escapes staging' }
      Assert-NoLinks $target
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
      [IO.Compression.ZipFileExtensions]::ExtractToFile($file.entry, $target, $false)
      $result += [pscustomobject]@{ path = $file.path; sha256 = (Get-Sha256 $target) }
    }
    [Console]::OutputEncoding = [Text.Encoding]::UTF8
    [Console]::Write((@{ files = $result; totalSize = $total } | ConvertTo-Json -Depth 4 -Compress))
  } finally { $zip.Dispose() }
  exit 0
}

if ($env:WWT_UPDATE_MODE -eq 'recover') {
  $planPath = [IO.Path]::GetFullPath($env:WWT_UPDATE_PLAN)
  Assert-NoLinks $planPath
  $plan = [IO.File]::ReadAllText($planPath) | ConvertFrom-Json
  $running = @(Get-Process -Name WWT -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $plan.root 'WWT.exe') })
  if ($running.Count) { throw 'Close WWT before recovery' }
  Restore-AppPackage $plan ([IO.Path]::GetDirectoryName($planPath))
  exit 0
}

if ($env:WWT_UPDATE_MODE -ne 'apply') { throw 'Invalid update mode' }
$planPath = [IO.Path]::GetFullPath($env:WWT_UPDATE_PLAN)
$workspace = [IO.Path]::GetDirectoryName($planPath)
$resultPath = Join-Path $workspace 'result.json'
$committed = $false
try {
  Assert-NoLinks $planPath
  $plan = [IO.File]::ReadAllText($planPath) | ConvertFrom-Json
  $root = [IO.Path]::GetFullPath($plan.root.Replace('/', '\'))
  if ([IO.Path]::GetDirectoryName($workspace) -ne $root -or -not [IO.Path]::GetFileName($workspace).StartsWith('.wwt-app-update-')) { throw 'Invalid update workspace' }
  $staging = Join-Path $workspace 'package'
  $backup = Join-Path $workspace 'backup'
  Assert-NoLinks $root
  Assert-NoLinks $staging
  $paths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($file in $plan.files) {
    $relative = Get-SafeRelative $file.path
    if (-not $paths.Add($relative)) { throw 'Duplicate update target' }
    $source = Join-Path $staging $relative
    Assert-NoLinks $source
    Assert-NoLinks (Join-Path $root $relative)
    if ((Get-Sha256 $source) -ne $file.sha256) { throw 'Staged file checksum failed' }
  }
  foreach ($required in @('WWT.exe', 'libwebview.dll', 'hpatchz.exe', 'carlotta.png', 'msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'LICENSE', 'README.txt')) { if (-not $paths.Contains($required)) { throw 'Incomplete update plan' } }
  $parent = Get-Process -Id $plan.processId -ErrorAction Stop
  if ($parent.MainModule.FileName -ne (Join-Path $root 'WWT.exe')) { throw 'Update parent does not match' }
  if (Test-Path -LiteralPath $backup) { throw 'Update backup already exists' }
  [IO.File]::WriteAllText((Join-Path $workspace 'ready'), 'ready')
  if (-not $parent.WaitForExit(60000)) { throw 'Application did not exit in time' }
  Install-AppPackage $plan $workspace
  $committed = $true
  Write-UpdateJson $resultPath @{ status = 'installed'; version = $plan.version; message = '应用更新已安装，原文件保存在此目录的 backup 中。' }
  Start-Process -FilePath (Join-Path $root 'WWT.exe') -WorkingDirectory $root -WindowStyle Normal
} catch {
  $message = $_.Exception.Message
  Write-UpdateJson $resultPath @{ status = $(if ($committed) { 'installed' } else { 'failed' }); message = $message }
  exit 1
}
