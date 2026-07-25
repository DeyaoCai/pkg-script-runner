# Remove "Pkg Runner" context menu entries from HKCU.
$ErrorActionPreference = 'SilentlyContinue'
$menuName = 'PkgRunner'

Remove-Item -Path "HKCU:\Software\Classes\Directory\shell\$menuName" -Recurse -Force
Remove-Item -Path "HKCU:\Software\Classes\Directory\Background\shell\$menuName" -Recurse -Force

Write-Host "已卸载右键菜单 Pkg Runner。"
