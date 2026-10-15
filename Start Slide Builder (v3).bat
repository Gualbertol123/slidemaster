@echo off
setlocal
title Slide Builder 3 (old version)
rem Slide Builder 3 after the move to Slide Builder 4 (docs/next/cutover.md): for a deck given back to Slide Builder 3
rem (Update Slide Builder.bat --rollback) or listed in backend\data\v4\pinned-v3.json. It starts the newest 3.x version
rem installed in app\ (else the 3.x program in backend\) on the same data as Slide Builder 4, from port 8785, so it
rem never opens Slide Builder 4's page (8765). Decks that Slide Builder 4 owns are refused by Slide Builder 3 itself.
rem Removed after the four weeks of monitoring (PLAN S6.5).
rem pushd (not cd /d) so that this also works when the folder is opened as \\server\share\...

set "PY="
where py >nul 2>nul && py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
if defined PY goto found
python -c "import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)" >nul 2>nul && set "PY=python"
if defined PY goto found
echo Python 3 was not found on this PC - run "Install Slide Builder.bat" first.
pause
exit /b 1

:found
set "DIR="
set "PICK=%TEMP%\slidebuilder-v3-%RANDOM%%RANDOM%.txt"
rem the newest app\3.x.y with backend\slide_builder.py; only the version is printed (ASCII by the pattern)
%PY% -c "import os,re,sys; a=os.path.join(sys.argv[1],'app'); v=[n for n in (os.listdir(a) if os.path.isdir(a) else []) if re.match(r'^3[.][0-9]+[.][0-9]+$',n) and os.path.isfile(os.path.join(a,n,'backend','slide_builder.py'))]; v.sort(key=lambda n: tuple(int(x) for x in n.split('.'))); print(v[-1] if v else '')" "%~dp0." >"%PICK%" 2>nul
set "VER="
set /p VER=<"%PICK%"
del "%PICK%" >nul 2>nul
if defined VER set "DIR=%~dp0app\%VER%\backend"
if not defined DIR if exist "%~dp0backend\slide_builder.py" set "DIR=%~dp0backend"
if not defined DIR (echo Slide Builder 3 is not installed in this folder. & pause & exit /b 1)
echo.
echo  Slide Builder 3 - the OLD version. Use it only for a deck given back to Slide Builder 3.
echo  For everything else use "Start Slide Builder.bat".
echo.
pushd "%DIR%" || (echo The folder "%DIR%" cannot be opened. & pause & exit /b 1)
%PY% slide_builder.py --port 8785 %*
if errorlevel 1 (
  echo.
  echo Slide Builder 3 could not start ^(above^).
  popd
  pause
  exit /b 1
)
popd
