@echo off
echo ================================================================
echo Iris AI - Local TTS/STT Service Setup
echo ================================================================
echo.

echo Step 1: Installing Python dependencies...
echo.
pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo [ERROR] Failed to install dependencies!
    echo Make sure Python and pip are installed and in your PATH.
    pause
    exit /b 1
)

echo.
echo ================================================================
echo Step 2: Downloading voice models...
echo ================================================================
echo.
python download_voices.py
if errorlevel 1 (
    echo.
    echo [ERROR] Failed to download voice models!
    pause
    exit /b 1
)

echo.
echo ================================================================
echo Setup Complete!
echo ================================================================
echo.
echo To start the service:
echo   python server.py
echo.
echo The service will run on http://localhost:5000
echo.
pause
