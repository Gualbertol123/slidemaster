@echo off
title Slide Builder
cd /d "%~dp0backend"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 slide_builder.py
) else (
  python slide_builder.py
)
if errorlevel 1 (
  echo.
  echo Slide Builder could not start. Python 3 is required: https://www.python.org/downloads/
  pause
)
