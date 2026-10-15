@echo off
setlocal
title Slide Builder
rem Starts the version named in app\current.json (side-by-side installs: tools\update.py --release),
rem otherwise the program in helper\ (backend\ before 4.0). No PowerShell: app\current.json is read with Python.
rem The data stays in backend\data\ in every case.
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
set "PROG=%~dp0helper"
if not exist "%~dp0helper\slide_builder.py" set "PROG=%~dp0backend"
set "DIR=%PROG%"
if not exist "%~dp0app\current.json" goto start
set "PICK=%TEMP%\slidebuilder-start-%RANDOM%%RANDOM%.txt"
rem only the version is printed (ASCII by the pattern): a folder path with accents would not survive cmd
%PY% -c "import json,os,re,sys; v=json.load(open(os.path.join(sys.argv[1],'app','current.json'),encoding='utf-8')).get('version') or ''; print(v if re.match(r'^[0-9]+[.][0-9]+[.][0-9]+([-][0-9A-Za-z.]+)?$',v) else '')" "%~dp0." >"%PICK%" 2>nul
set "VER="
set /p VER=<"%PICK%"
del "%PICK%" >nul 2>nul
rem 4.x versions keep the program in helper\, 3.x versions (still usable with --use) in backend\
if defined VER if exist "%~dp0app\%VER%\backend\slide_builder.py" set "DIR=%~dp0app\%VER%\backend"
if defined VER if exist "%~dp0app\%VER%\helper\slide_builder.py" set "DIR=%~dp0app\%VER%\helper"
if not "%DIR%"=="%PROG%" goto start
echo app\current.json names no usable version - starting the program in "%PROG%" instead.

:start
pushd "%DIR%" || (echo The folder "%DIR%" cannot be opened. & pause & exit /b 1)
%PY% slide_builder.py
if errorlevel 1 (
  echo.
  echo Slide Builder could not start. Python 3 is required - run "Install Slide Builder.bat" first.
  popd
  pause
  exit /b 1
)
popd
