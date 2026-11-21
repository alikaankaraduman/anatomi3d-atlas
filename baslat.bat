@echo off
title Anatomi 3D
cd /d "%~dp0app"
if not exist node_modules (
  echo Bagimliliklar kuruluyor, bu bir kez yapilir...
  call npm install
)
echo.
echo Anatomi 3D baslatiliyor. Tarayici kendiliginden acilacak.
echo Kapatmak icin bu pencereyi kapatin.
echo.
call npm run dev -- --open
pause
