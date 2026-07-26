# Register "Code Editor" on folder / folder-background context menu (HKCU, no admin).
$ErrorActionPreference = 'Stop'

$appDir = Split-Path -Parent $PSScriptRoot
$launchCmd = Join-Path $PSScriptRoot 'launch.cmd'
$releaseDir = Join-Path $appDir 'release'
$menuName = 'CodeEditor'
$menuLabel = '用 Code Editor 打开'

$launcher = $null
$portable = Get-ChildItem -Path $releaseDir -Filter 'CodeEditor-*-portable.exe' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if ($portable) {
  $launcher = $portable.FullName
} elseif (Test-Path $launchCmd) {
  $launcher = (Resolve-Path $launchCmd).Path
} else {
  throw "缺少启动器：既无 release\CodeEditor-*-portable.exe，也无 $launchCmd"
}

function Set-ShellKey([string]$baseKey) {
  $key = Join-Path $baseKey $menuName
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -Path $key -Name '(default)' -Value $menuLabel
  Set-ItemProperty -Path $key -Name 'Icon' -Value 'imageres.dll,-5322'
  $cmdKey = Join-Path $key 'command'
  New-Item -Path $cmdKey -Force | Out-Null
  $command = "`"$launcher`" `"%V`""
  Set-ItemProperty -Path $cmdKey -Name '(default)' -Value $command
}

Set-ShellKey 'HKCU:\Software\Classes\Directory\shell'
Set-ShellKey 'HKCU:\Software\Classes\Directory\Background\shell'

Write-Host "已注册右键菜单: $menuLabel"
Write-Host "  启动器: $launcher"
Write-Host "卸载: pnpm --filter code-editor uninstall-context-menu"
