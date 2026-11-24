@echo off
cd /d "%~dp0"
node app\launcher.mjs stop
if errorlevel 1 pause
