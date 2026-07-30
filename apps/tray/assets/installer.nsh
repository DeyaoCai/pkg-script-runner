# electron-builder NSIS hook — 强制写桌面 + 开始菜单快捷方式
# （assisted 安装页即使用户取消勾选，也会创建）
!macro customInstall
  DetailPrint "Create Pkg Runner shortcuts"
  CreateShortCut "$DESKTOP\Pkg Runner.lnk" "$INSTDIR\PkgRunnerTray.exe" "" "$INSTDIR\PkgRunnerTray.exe" 0 SW_SHOWNORMAL "" "Pkg Runner"
  CreateDirectory "$SMPROGRAMS"
  CreateShortCut "$SMPROGRAMS\Pkg Runner.lnk" "$INSTDIR\PkgRunnerTray.exe" "" "$INSTDIR\PkgRunnerTray.exe" 0 SW_SHOWNORMAL "" "Pkg Runner"
!macroend
