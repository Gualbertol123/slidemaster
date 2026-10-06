@echo off
setlocal
title Slide Builder - update from GitHub
rem Connects this folder to GitHub (first time, in place) or updates it. Saved decks, settings, logo,
rem workbooks and exports are never changed - see tools\update.py. Safe to run again.
rem pushd (not cd /d) so that this also works when the folder is opened as \\server\share\...
pushd "%~dp0" || (echo The folder "%~dp0" cannot be opened. & pause & exit /b 1)

set "PY="
where py >nul 2>nul && py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
if defined PY goto found
python -c "import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)" >nul 2>nul && set "PY=python"
if defined PY goto found
echo Python 3 was not found on this PC - run "Install Slide Builder.bat" first.
popd
pause
exit /b 1

:found
%PY% tools\update.py %*
set "RC=%errorlevel%"
popd
echo.
pause
exit /b %RC%
