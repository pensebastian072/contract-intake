@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-shortcut.ps1"
if errorlevel 1 (
  echo Shortcut setup failed. See the message above.
  pause
  exit /b 1
)
echo Desktop shortcut created. Double-click Contract Intake to open the app.
pause
