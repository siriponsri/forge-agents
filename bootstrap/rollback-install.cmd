@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0rollback-install.ps1"
pause
