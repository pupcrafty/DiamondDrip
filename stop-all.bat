@echo off
echo ========================================
echo Stopping All DiamondDrip Servers
echo ========================================
echo.

setlocal enabledelayedexpansion

REM Stop Player Server (port 8443)
echo Stopping Player Server (port 8443)...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8443" ^| findstr "LISTENING"') do (
    set PID=%%a
    if not "!PID!"=="" (
        set PID=!PID: =!
        if not "!PID!"=="" (
            echo   Found process !PID! on port 8443, killing...
            taskkill /PID !PID! /F 2>&1
            if !errorlevel! equ 0 (
                echo   Successfully killed process !PID!
            )
        )
    )
)

REM Stop Debug Server (port 9001)
echo Stopping Debug Server (port 9001)...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":9001" ^| findstr "LISTENING"') do (
    set PID=%%a
    if not "!PID!"=="" (
        set PID=!PID: =!
        if not "!PID!"=="" (
            echo   Found process !PID! on port 9001, killing...
            taskkill /PID !PID! /F 2>&1
            if !errorlevel! equ 0 (
                echo   Successfully killed process !PID!
            )
        )
    )
)

REM Stop Prediction Server (port 8444)
echo Stopping Prediction Server (port 8444)...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8444" ^| findstr "LISTENING"') do (
    set PID=%%a
    if not "!PID!"=="" (
        set PID=!PID: =!
        if not "!PID!"=="" (
            echo   Found process !PID! on port 8444, killing...
            taskkill /PID !PID! /F 2>&1
            if !errorlevel! equ 0 (
                echo   Successfully killed process !PID!
            )
        )
    )
)

REM Also try to kill by window title (for the cmd windows)
echo.
echo Closing server windows...
taskkill /FI "WINDOWTITLE eq DiamondDrip Player Server*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq DiamondDrip Debug Server*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq DiamondDrip Prediction Server*" /F >nul 2>&1

REM Additional cleanup: kill Python processes running the specific scripts
echo.
echo Checking for Python processes running server scripts...
for /f "tokens=2" %%a in ('tasklist /FI "IMAGENAME eq python.exe" /FO LIST 2^>nul ^| findstr "PID:"') do (
    set PID=%%a
    set PID=!PID:PID:=!
    set PID=!PID: =!
    if not "!PID!"=="" (
        REM Check command line for server scripts
        wmic process where "ProcessId=!PID!" get CommandLine 2^>nul | findstr /i "server.py\|microphone_info_server.py\|prediction_server.py" >nul
        if !errorlevel! equ 0 (
            echo   Killing Python process !PID! running server script...
            taskkill /PID !PID! /F 2>&1
        )
    )
)

REM Also try using PowerShell for more reliable port killing
echo.
echo Verifying ports are closed...
powershell -Command "$ports = @(8443, 9001, 8444); foreach ($port in $ports) { $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Where-Object {$_.State -eq 'Listen'}; if ($connections) { foreach ($conn in $connections) { $pid = $conn.OwningProcess; Write-Host \"Found process $pid on port $port, killing...\"; Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue } } }" 2>nul

echo.
echo ========================================
echo All servers stopped!
echo ========================================
echo.
timeout /t 2 /nobreak >nul

