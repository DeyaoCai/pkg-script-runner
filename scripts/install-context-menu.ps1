# Register "Pkg Runner" on folder / folder-background context menu (HKCU, no admin).
# Prefer release\PkgRunner-*-portable.exe when present; else scripts\launch.cmd (dev).
$ErrorActionPreference = 'Stop'

$appDir = Split-Path -Parent $PSScriptRoot
$launchCmd = Join-Path $PSScriptRoot 'launch.cmd'
$releaseDir = Join-Path $appDir 'release'
$menuName = 'PkgRunner'
$menuLabel = '用 Pkg Runner 打开'

$launcher = $null
$portable = Get-ChildItem -Path $releaseDir -Filter 'PkgRunner-*-portable.exe' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if ($portable) {
  $launcher = $portable.FullName
} elseif (Test-Path $launchCmd) {
  $launcher = (Resolve-Path $launchCmd).Path
} else {
  throw "缺少启动器：既无 release\PkgRunner-*-portable.exe，也无 $launchCmd"
}

function Set-ShellKey([string]$baseKey) {
  $key = Join-Path $baseKey $menuName
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -Path $key -Name '(default)' -Value $menuLabel
  Set-ItemProperty -Path $key -Name 'Icon' -Value 'imageres.dll,-5322'
  $cmdKey = Join-Path $key 'command'
  New-Item -Path $cmdKey -Force | Out-Null
  # %V = 选中目录；背景菜单时为当前文件夹
  $command = "`"$launcher`" `"%V`""
  Set-ItemProperty -Path $cmdKey -Name '(default)' -Value $command
}

Set-ShellKey 'HKCU:\Software\Classes\Directory\shell'
Set-ShellKey 'HKCU:\Software\Classes\Directory\Background\shell'

Write-Host "已注册右键菜单: $menuLabel"
Write-Host "  启动器: $launcher"
Write-Host "  项目:   $appDir"
Write-Host ""
Write-Host "在资源管理器中右键文件夹（或文件夹空白处）即可打开。"
Write-Host "卸载: pnpm --filter pkg-runner uninstall-context-menu"
