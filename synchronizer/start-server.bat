@echo off
echo Starting DiamondDrip Prediction Server...
echo.

REM Try the Python script first
python prediction_server.py 2>nul
if %errorlevel% neq 0 (
    python3 prediction_server.py 2>nul
    if %errorlevel% neq 0 (
        echo.
        echo Python not found. Please install Python.
        echo.
        pause
    )
)




