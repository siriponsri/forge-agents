@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo FORGE needs Node.js 24.13 or newer. Install Node.js LTS from https://nodejs.org then open this file again.
  pause
  exit /b 1
)
node app\launcher.mjs start
if errorlevel 1 pause
