@echo off
setlocal
title Slide Builder - first-time set-up
rem Runs "slide_builder.py --install": Python check, shared-folder and journal checks,
rem desktop shortcut and a self-test. Nothing is downloaded. No administrator rights needed. Safe to run again.
rem The program: the version named in app\current.json (side-by-side installs), otherwise helper\ (backend\ before
rem 4.0) - the same choice as "Start Slide Builder.bat".
rem pushd (not cd /d) so that this also works when the folder is opened as \\server\share\...

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
pause
exit /b 1

:found
set "PROG=%~dp0helper"
if not exist "%~dp0helper\slide_builder.py" set "PROG=%~dp0backend"
if not exist "%~dp0app\current.json" goto chosen
set "PICK=%TEMP%\slidebuilder-install-%RANDOM%%RANDOM%.txt"
%PY% -c "import json,os,re,sys; v=json.load(open(os.path.join(sys.argv[1],'app','current.json'),encoding='utf-8')).get('version') or ''; print(v if re.match(r'^[0-9]+[.][0-9]+[.][0-9]+([-][0-9A-Za-z.]+)?$',v) else '')" "%~dp0." >"%PICK%" 2>nul
set "VER="
set /p VER=<"%PICK%"
del "%PICK%" >nul 2>nul
if defined VER if exist "%~dp0app\%VER%\backend\slide_builder.py" set "PROG=%~dp0app\%VER%\backend"
if defined VER if exist "%~dp0app\%VER%\helper\slide_builder.py" set "PROG=%~dp0app\%VER%\helper"

:chosen
if not exist "%PROG%\slide_builder.py" (echo Slide Builder is not installed in this folder. & pause & exit /b 1)
pushd "%PROG%" || (echo The folder "%PROG%" cannot be opened. & pause & exit /b 1)
echo Using: %PY%
%PY% slide_builder.py --install
set "RC=%errorlevel%"
popd
echo.
pause
exit /b %RC%
