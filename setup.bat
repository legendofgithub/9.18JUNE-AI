@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo   June AI v2.0 - First Time Setup
echo ============================================
echo.

echo [1/5] Checking Python...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo   ERROR: Python not found. Install Python 3.10+ first.
    pause & exit /b 1
)
echo   OK

echo.
echo [2/5] Creating virtual environment...
if not exist ".venv\Scripts\python.exe" (
    python -m venv .venv
    if %errorlevel% neq 0 (
        echo   ERROR: Failed to create venv.
        pause & exit /b 1
    )
)
echo   OK

echo.
echo [3/5] Upgrading pip (to ensure wheel support)...
.venv\Scripts\python.exe -m pip install --upgrade pip -q
if %errorlevel% neq 0 (
    echo   WARNING: pip upgrade failed, continuing with current version...
)
echo   OK

echo.
echo [4/5] Installing Python dependencies...
.venv\Scripts\pip.exe install -r backend\requirements.txt
if %errorlevel% neq 0 (
    echo   ERROR: pip install failed.
    echo.
    echo   Try manually:
    echo     .venv\Scripts\python.exe -m pip install --upgrade pip
    echo     .venv\Scripts\pip.exe install -r backend\requirements.txt
    pause & exit /b 1
)
echo   OK

echo.
echo [5/5] Checking Node.js and installing frontend deps...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo   ERROR: Node.js not found. Install Node.js 18+ first.
    pause & exit /b 1
)
cd frontend
call npm install --legacy-peer-deps
if %errorlevel% neq 0 (
    cd ..
    echo   ERROR: npm install failed.
    pause & exit /b 1
)
cd ..
echo   OK

echo.
echo ============================================
echo   Setup complete! Run run.bat to start.
echo ============================================
pause
