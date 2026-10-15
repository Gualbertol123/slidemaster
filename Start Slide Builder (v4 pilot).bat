@echo off
setlocal
title PILOT - copy of the data - Slide Builder 4
rem The Slide Builder 4 pilot (docs/next/pilot-v4.md). It runs the version named in app\pilot.json on a COPY of the
rem data: backend\data\v4-pilot, made once at the first start ("--refresh" takes a new copy; refused while somebody
rem is in the copy). Exports go to export\v4-pilot\. The real data in backend\data is never written by the pilot.
rem   "Start Slide Builder (v4 pilot).bat"            start the pilot
rem   "Start Slide Builder (v4 pilot).bat" --refresh  start it on a new copy of the data (the old copy is kept)
rem   "Start Slide Builder (v4 pilot).bat" --v3       the rollback rehearsal: Slide Builder 3 on the same copy
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
set "SLIDEBUILDER_DATA=%~dp0backend\data\v4-pilot"
set "SLIDEBUILDER_EXPORT=%~dp0export\v4-pilot"
if /i "%~1"=="--v3" goto v3
set "VER="
if not exist "%~dp0app\pilot.json" goto nopilot
set "PICK=%TEMP%\slidebuilder-pilot-%RANDOM%%RANDOM%.txt"
rem only the version is printed (ASCII by the pattern): a folder path with accents would not survive cmd
%PY% -c "import json,os,re,sys; v=json.load(open(os.path.join(sys.argv[1],'app','pilot.json'),encoding='utf-8')).get('version') or ''; print(v if re.match(r'^[0-9]+[.][0-9]+[.][0-9]+([-][0-9A-Za-z.]+)?$',v) else '')" "%~dp0." >"%PICK%" 2>nul
set /p VER=<"%PICK%"
del "%PICK%" >nul 2>nul
if not defined VER goto nopilot
if not exist "%~dp0app\%VER%\helper\slide_builder.py" goto nopilot
set "DIR=%~dp0app\%VER%\helper"
echo.
echo  PILOT - Slide Builder %VER% on a COPY of the data.
echo  What you change here does not reach Slide Builder 3 and is not kept after the pilot.
echo.
pushd "%DIR%" || (echo The folder "%DIR%" cannot be opened. & pause & exit /b 1)
%PY% slide_builder.py --pilot %*
if errorlevel 1 (
  echo.
  echo The pilot did not start ^(above^).
  popd
  pause
  exit /b 1
)
popd
exit /b 0

:nopilot
echo No pilot is installed in this folder (app\pilot.json). The maintainer installs it with
echo   py -3 C:\temp\sb-pilot\tools\update.py --root "%~dp0." --pilot --zip slidebuilder-4.0.0-pilot.zip
echo with the updater of the UNZIPPED pilot ZIP (here C:\temp\sb-pilot), not this folder's: see docs/next/pilot-v4.md.
pause
exit /b 1

:v3
rem Slide Builder 3 (the version in use: app\current.json's 3.x, else backend\) on the pilot's copy, from port 8885
title PILOT - copy of the data - Slide Builder 3 (rollback rehearsal)
if not exist "%SLIDEBUILDER_DATA%\" (echo There is no pilot copy yet - start the pilot first. & pause & exit /b 1)
set "DIR=%~dp0backend"
set "PICK=%TEMP%\slidebuilder-pilot-%RANDOM%%RANDOM%.txt"
%PY% -c "import json,os,re,sys; v=json.load(open(os.path.join(sys.argv[1],'app','current.json'),encoding='utf-8')).get('version') or ''; print(v if re.match(r'^3[.][0-9]+[.][0-9]+([-][0-9A-Za-z.]+)?$',v) else '')" "%~dp0." >"%PICK%" 2>nul
set "VER="
set /p VER=<"%PICK%"
del "%PICK%" >nul 2>nul
if defined VER if exist "%~dp0app\%VER%\backend\slide_builder.py" set "DIR=%~dp0app\%VER%\backend"
if not exist "%DIR%\slide_builder.py" (echo Slide Builder 3 is not installed in this folder. & pause & exit /b 1)
rem Slide Builder 3 imports old v2 settings into the data folder it is given, renaming the settings file in backend\:
rem never on the copy unless the real data has imported them already (then the copy has migrated.json too)
%PY% -c "import os,sys; sys.exit(1 if os.path.isfile(os.path.join(sys.argv[2],'slide_builder_settings.txt')) and not os.path.isfile(os.path.join(sys.argv[1],'migrated.json')) else 0)" "%SLIDEBUILDER_DATA%" "%~dp0backend"
if errorlevel 1 (echo The copy has not imported the old v2 settings - not started. & pause & exit /b 1)
echo.
echo  PILOT ROLLBACK REHEARSAL - Slide Builder 3 on the COPY of the data. Do not export from here:
echo  Slide Builder 3 writes its exports to the real export\ folder.
echo.
pushd "%DIR%" || (echo The folder "%DIR%" cannot be opened. & pause & exit /b 1)
%PY% slide_builder.py --port 8885
if errorlevel 1 (
  echo.
  echo Slide Builder 3 could not start ^(above^).
  popd
  pause
  exit /b 1
)
popd
