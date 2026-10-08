@echo off
chcp 65001 > nul
title Lumina Flipbook Launcher
echo ========================================================
echo   Starting Lumina Flipbook Reader...
echo ========================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run_flipbook.ps1"
pause
