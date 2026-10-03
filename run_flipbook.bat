@echo off
title Lumina Flipbook Launcher
echo ========================================================
echo   Starting Lumina Flipbook for เล่ม.pdf...
echo ========================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run_flipbook.ps1"
pause
