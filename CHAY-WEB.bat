@echo off
chcp 65001 >nul
title Web HoHai VN
cd /d "%~dp0"
set PORT=8080

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Chua cai Node.js. Tai ban LTS tai https://nodejs.org roi chay lai file nay.
  echo   未安装 Node.js。请到 https://nodejs.org 下载 LTS 版本安装后再运行本文件。
  echo.
  start "" https://nodejs.org/
  pause
  exit /b 1
)

rem Mo trinh duyet sau 2 giay
start "" /b cmd /c "timeout /t 2 >nul & start http://localhost:%PORT%"
node tools\serve.js %PORT%
pause
