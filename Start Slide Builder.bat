@echo off
title Slide Builder
rem pushd (not cd /d) so that this also works when the folder is opened as \\server\share\...
pushd "%~dp0backend" || (echo The folder "%~dp0backend" cannot be opened. & pause & exit /b 1)
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 slide_builder.py
) else (
  python slide_builder.py
)
if errorlevel 1 (
  echo.
  echo Slide Builder could not start. Python 3 is required - run "Install Slide Builder.bat" first.
  popd
  pause
  exit /b 1
)
popd
