@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0doctor.ps1" -TargetRoot "%LOCALAPPDATA%\FORGE\forge-v1-portable"
pause
