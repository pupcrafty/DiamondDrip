@echo off
echo Starting DiamondDrip server...
echo.

REM Try the Python script first (shows IP address automatically)
python server.py 2>nul
if %errorlevel% neq 0 (
    python3 server.py 2>nul
    if %errorlevel% neq 0 (
        REM Fallback to simple http.server
        echo Trying alternative method...
        python -m http.server 8000 --bind 0.0.0.0 2>nul
        if %errorlevel% neq 0 (
            python3 -m http.server 8000 --bind 0.0.0.0 2>nul
            if %errorlevel% neq 0 (
                echo.
                echo Python not found. Please install Python or use Node.js:
                echo   npx http-server -p 8000 -a 0.0.0.0
                echo.
                echo Or run: get-ip.ps1 to find your IP address first
                pause
            )
        )
    )
)

