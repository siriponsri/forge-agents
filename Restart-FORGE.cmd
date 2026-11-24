@echo off
cd /d "%~dp0"
node app\launcher.mjs restart
if errorlevel 1 pause
