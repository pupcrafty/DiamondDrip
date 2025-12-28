@echo off
echo ========================================
echo Starting All DiamondDrip Servers
echo ========================================
echo.

REM Get the script directory (project root)
set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

REM Determine Python command (python or python3)
python --version >nul 2>&1
if %errorlevel% equ 0 (
    set PYTHON_CMD=python
) else (
    set PYTHON_CMD=python3
)

echo Starting Player Server (port 8443)...
start "DiamondDrip Player Server" cmd /k "cd /d %SCRIPT_DIR%player && %PYTHON_CMD% server.py"

timeout /t 2 /nobreak >nul

echo Starting Debug Server (port 9001)...
REM Check if Flask is installed for debug server
%PYTHON_CMD% -c "import flask" >nul 2>&1
if %errorlevel% neq 0 (
    echo   Flask not found. Installing Flask...
    cd /d "%SCRIPT_DIR%debughelper"
    pip install -r requirements.txt >nul 2>&1
    cd /d "%SCRIPT_DIR%"
)
start "DiamondDrip Debug Server" cmd /k "cd /d %SCRIPT_DIR%debughelper && %PYTHON_CMD% microphone_info_server.py"

timeout /t 2 /nobreak >nul

echo Starting Prediction Server (port 8444)...
start "DiamondDrip Prediction Server" cmd /k "cd /d %SCRIPT_DIR%synchronizer && %PYTHON_CMD% prediction_server.py"

timeout /t 2 /nobreak >nul

echo.
echo ========================================
echo All servers started!
echo ========================================
echo.
echo Three windows have been opened, one for each server.
echo Close the windows or run stop-all.bat to stop all servers.
echo.

