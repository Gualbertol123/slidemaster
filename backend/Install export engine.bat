@echo off
title Slide Builder - install export engine
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 slide_builder.py --setup
) else (
  python slide_builder.py --setup
)
echo.
pause
