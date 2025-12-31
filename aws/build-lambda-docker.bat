@echo off
REM Build Lambda deployment package using Docker (ensures Linux wheels)

echo Building Lambda deployment package with Docker (Linux wheels)...
echo.

REM Get the directory where this script is located
cd /d "%~dp0"

REM Docker image name
set IMAGE_NAME=diamonddrip-lambda-builder:latest

REM Build the Docker image
echo Building Docker image...
docker build -t %IMAGE_NAME% .

if %errorlevel% neq 0 (
    echo ERROR: Docker build failed
    exit /b 1
)

REM Create a temporary container to extract the package
echo Creating temporary container...
for /f "tokens=*" %%i in ('docker create %IMAGE_NAME%') do set CONTAINER_ID=%%i

if %errorlevel% neq 0 (
    echo ERROR: Failed to create container
    exit /b 1
)

REM Extract the lambda package from the container
echo Extracting lambda-package.zip from container...
docker cp %CONTAINER_ID%:/build/lambda-package.zip lambda-package-docker.zip

if %errorlevel% neq 0 (
    echo ERROR: Failed to extract package from container
    docker rm %CONTAINER_ID%
    exit /b 1
)

REM Remove the temporary container
echo Cleaning up temporary container...
docker rm %CONTAINER_ID%

REM Check if the file was created
if exist "lambda-package-docker.zip" (
    echo.
    echo Lambda package created successfully: lambda-package-docker.zip
    echo.
    echo This package contains Linux wheels and is ready for AWS Lambda deployment.
) else (
    echo ERROR: Failed to create lambda-package-docker.zip
    exit /b 1
)

