@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

set "NEX_PORT=8765"
set "NEX_URL=http://127.0.0.1:%NEX_PORT%/"

where py >nul 2>nul
if not errorlevel 1 (
    py -3 -c "import sys; raise SystemExit(0 if sys.version_info.major == 3 else 1)" >nul 2>nul
    if not errorlevel 1 goto run_with_py
)

set "NEX_PYTHON_EXE="
for /f "delims=" %%P in ('where python 2^>nul') do (
    echo %%P | findstr /i /l /c:"\Microsoft\WindowsApps\python.exe" >nul
    if errorlevel 1 if not defined NEX_PYTHON_EXE set "NEX_PYTHON_EXE=%%P"
)
if not defined NEX_PYTHON_EXE goto python_not_found
"%NEX_PYTHON_EXE%" -c "import sys; raise SystemExit(0 if sys.version_info.major == 3 else 1)" >nul 2>nul
if errorlevel 1 goto python_not_found
goto run_with_python

:run_with_py
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 900; Start-Process '%NEX_URL%'"
echo NEX ESTATE Media Studio: %NEX_URL%
echo Для остановки сервера нажмите Ctrl+C.
py -3 nex_server.py --port %NEX_PORT% --bind 127.0.0.1
exit /b %errorlevel%

:run_with_python
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 900; Start-Process '%NEX_URL%'"
echo NEX ESTATE Media Studio: %NEX_URL%
echo Для остановки сервера нажмите Ctrl+C.
"%NEX_PYTHON_EXE%" nex_server.py --port %NEX_PORT% --bind 127.0.0.1
exit /b %errorlevel%

:python_not_found
echo Python 3 не найден.
echo Установите Python 3.12 командой:
echo winget install --id Python.Python.3.12 -e
echo Затем снова запустите START_WINDOWS.cmd.
pause
exit /b 1
