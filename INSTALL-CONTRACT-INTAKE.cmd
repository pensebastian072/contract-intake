@echo off
setlocal
title Contract Intake Setup

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Installing the required Node.js component...
  where winget.exe >nul 2>nul
  if errorlevel 1 goto :manual_node
  winget.exe install --id OpenJS.NodeJS.LTS --exact --accept-source-agreements --accept-package-agreements
  if errorlevel 1 goto :manual_node
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-shortcut.ps1"
if errorlevel 1 goto :failed

call "%~dp0start-contract-intake.cmd"
if errorlevel 1 goto :failed
exit /b 0

:manual_node
echo.
echo Automatic setup could not install Node.js.
echo Opening the official Node.js download page. Install the LTS version,
echo then double-click INSTALL-CONTRACT-INTAKE.cmd again.
start "" "https://nodejs.org/en/download"
pause
exit /b 1

:failed
echo.
echo Contract Intake setup did not finish. Review the message above and try again.
pause
exit /b 1
