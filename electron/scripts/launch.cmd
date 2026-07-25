@echo off
setlocal
REM Launcher for Windows context menu / CLI: launch.cmd <project-dir>
set "APP_DIR=%~dp0.."
cd /d "%APP_DIR%" || exit /b 1

if not exist "dist\main.js" (
  echo [pkg-runner] building...
  call pnpm build
  if errorlevel 1 exit /b 1
)

if "%~1"=="" (
  call pnpm exec electron .
) else (
  call pnpm exec electron . "%~1"
)
