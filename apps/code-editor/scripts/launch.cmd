@echo off
REM Dev launcher for context menu: open folder with code-editor
setlocal
set "APP_DIR=%~dp0.."
cd /d "%APP_DIR%"
set "CODE_EDITOR_OPEN_DIR=%~1"
call pnpm.cmd exec electron .
