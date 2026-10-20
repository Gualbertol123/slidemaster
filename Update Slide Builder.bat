@echo off
setlocal
title Slide Builder - update from GitHub
rem Connects this folder to GitHub (first time, in place) or updates it. Saved decks, settings, logo,
rem workbooks and exports are never changed - see tools\update.py. Safe to run again.
rem pushd (not cd /d) so that this also works when the folder is opened as \\server\share\...
pushd "%~dp0" || (echo The folder "%~dp0" cannot be opened. & pause & exit /b 1)

rem Python 3.8 or newer (tools\update.py needs it). "python" may be the Microsoft Store's placeholder, which runs
rem nothing and fails the check, so it is never picked.
set "PY="
where py >nul 2>nul && py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul && set "PY=py -3"
if defined PY goto found
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul && set "PY=python"
if defined PY goto found
echo Python 3.8 or newer was not found on this PC - run "Install Slide Builder.bat" first.
popd
echo.
pause
exit /b 1

:found
%PY% tools\update.py %*
set "RC=%errorlevel%"
popd
echo.
if not "%RC%"=="0" echo The update stopped - the message above says why (exit code %RC%).
rem the window stays open so that the message can be read (a double-clicked .bat closes when it ends)
pause
exit /b %RC%
