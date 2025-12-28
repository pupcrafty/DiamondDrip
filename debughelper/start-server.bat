@echo off
echo Starting Microphone Info Collection Server...
echo.

REM Check if Flask is installed
python -c "import flask" 2>nul
if %errorlevel% neq 0 (
    echo Flask is not installed. Installing...
    pip install -r requirements.txt
    if %errorlevel% neq 0 (
        echo.
        echo Failed to install Flask. Please install manually:
        echo   pip install flask
        pause
        exit /b 1
    )
)

REM Start the server
python microphone_info_server.py

if %errorlevel% neq 0 (
    python3 microphone_info_server.py
    if %errorlevel% neq 0 (
        echo.
        echo Failed to start server. Make sure Python is installed.
        pause
    )
)

