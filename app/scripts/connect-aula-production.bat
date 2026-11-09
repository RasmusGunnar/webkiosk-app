@echo off
chcp 65001 >nul
title Aula - Familiekalender
cd /d "%~dp0\.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 mangler. Installer Node.js 24 og start igen.
  pause
  exit /b 1
)
if not exist "node_modules\qrcode\package.json" (
  echo Projektets pakker mangler. Koer npm ci i denne app-mappe og start igen.
  pause
  exit /b 1
)
node scripts\aula-connect-production.mjs
pause
