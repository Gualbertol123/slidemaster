@echo off
setlocal
title Slide Builder - first-time set-up
rem Runs "slide_builder.py --install": Python packages, export engine, shared-folder check,
rem desktop shortcut and a self-test. No administrator rights needed. Safe to run again.
rem pushd (not cd /d) so that this also works when the folder is opened as \\server\share\...
pushd "%~dp0backend" || (echo The folder "%~dp0backend" cannot be opened. & pause & exit /b 1)

set "PY="
where py >nul 2>nul && py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
if defined PY goto found
python -c "import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)" >nul 2>nul && set "PY=python"
if defined PY goto found

echo.
echo  ==================================================================
echo   Python 3 was not found on this PC.
echo  ==================================================================
echo   Slide Builder needs Python 3.8 or newer (any newer version is fine).
echo.
echo   Get it from ONE of these (no administrator rights needed):
echo    - your company software portal / Software Center: search "Python"
echo    - https://www.python.org/downloads/windows/  - the Windows installer.
echo      Choose the per-user install ("Install Now", without admin
echo      privileges) and tick "Add python.exe to PATH".
echo.
echo   Note: if typing "python" opens the Microsoft Store, that is only a
echo   shortcut - Python is not installed yet.
echo.
echo   Then run "Install Slide Builder.bat" again.
echo  ==================================================================
popd
pause
exit /b 1

:found
echo Using: %PY%
%PY% slide_builder.py --install
set "RC=%errorlevel%"
popd
echo.
pause
exit /b %RC%
