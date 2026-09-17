@echo off
setlocal
title Contract Intake Setup

set "PACKAGE_URL=https://github.com/pensebastian072/contract-intake/releases/latest/download/Contract-Intake-Windows.zip"
if defined CONTRACT_INTAKE_PACKAGE_URL set "PACKAGE_URL=%CONTRACT_INTAKE_PACKAGE_URL%"

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Installing the required Node.js component...
  where winget.exe >nul 2>nul
  if errorlevel 1 goto :manual_node
  winget.exe install --id OpenJS.NodeJS.LTS --exact --accept-source-agreements --accept-package-agreements
  if errorlevel 1 goto :manual_node
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
)

set "SOURCE_ROOT=%~dp0."
if exist "%SOURCE_ROOT%\scripts\install-app.ps1" goto :run_install

echo Downloading the complete Contract Intake package...
set "BOOTSTRAP_ROOT=%TEMP%\ContractIntakeSetup-%RANDOM%-%RANDOM%"
set "BOOTSTRAP_ZIP=%BOOTSTRAP_ROOT%\Contract-Intake-Windows.zip"
set "BOOTSTRAP_CONTENT=%BOOTSTRAP_ROOT%\package"
mkdir "%BOOTSTRAP_CONTENT%" >nul 2>nul
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri '%PACKAGE_URL%' -OutFile '%BOOTSTRAP_ZIP%'; Expand-Archive -LiteralPath '%BOOTSTRAP_ZIP%' -DestinationPath '%BOOTSTRAP_CONTENT%' -Force"
if errorlevel 1 goto :download_failed
set "SOURCE_ROOT=%BOOTSTRAP_CONTENT%"

:run_install
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SOURCE_ROOT%\scripts\install-app.ps1" -SourceRoot "%SOURCE_ROOT%"
if errorlevel 1 goto :failed
exit /b 0

:download_failed
echo.
echo The complete package could not be downloaded. Check your internet connection and try again.
pause
exit /b 1

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
