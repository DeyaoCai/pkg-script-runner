# Unregister "Code Editor" folder context menu (HKCU).
$ErrorActionPreference = 'Stop'
$menuName = 'CodeEditor'

foreach ($base in @(
  'HKCU:\Software\Classes\Directory\shell',
  'HKCU:\Software\Classes\Directory\Background\shell'
)) {
  $key = Join-Path $base $menuName
  if (Test-Path $key) {
    Remove-Item -Path $key -Recurse -Force
    Write-Host "已删除 $key"
  }
}

Write-Host "右键菜单已卸载"
