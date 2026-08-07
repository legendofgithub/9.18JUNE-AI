@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo   June AI v2.0
echo ============================================
echo.

:: 0. Check .env
if not exist "backend\.env" (
    if exist "backend\.env.example" (
        copy "backend\.env.example" "backend\.env" >nul
        echo [0] .env created from .env.example
        echo     Configure DEEPSEEK_API_KEY and JUNE_API_TOKEN inside.
        echo.
    )
)

:: 1. Check venv
if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment not found. Run setup.bat first.
    pause & exit /b 1
)

:: 2. Check node_modules
if not exist "frontend\node_modules" (
    echo [ERROR] node_modules not found. Run setup.bat first.
    pause & exit /b 1
)

:: 3. Start backend via watchdog
echo [1] Starting backend (watchdog, port 8000)...
start "June-Backend" cmd /c "cd /d "%~dp0" && ".venv\Scripts\python.exe" watchdog.py --port 8000"

:: 4. Wait for backend
echo     Waiting for backend...
set ready=0
for /l %%i in (1,1,15) do (
    timeout /t 2 /nobreak >nul
    .venv\Scripts\python.exe -c "import urllib.request; r=urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=2); assert r.status==200" 2>nul
    if !errorlevel! equ 0 (
        set ready=1
        goto :backend_ok
    )
    echo     ... %%i
)
:backend_ok
if %ready% equ 1 (
    echo     Backend: http://localhost:8000 [OK]
) else (
    echo     Backend may still be starting, check the new window.
)

:: 5. Start frontend
echo.
echo [2] Starting frontend (port 5173)...
start "June-Frontend" cmd /c "cd /d "%~dp0frontend" && npx vite --host 0.0.0.0 --port 5173"

timeout /t 4 /nobreak >nul

echo.
echo ============================================
echo   Frontend: http://localhost:5173
echo   Backend:  http://localhost:8000
echo.
echo   First time? Check backend window for Token,
echo   paste it in the frontend settings page.
echo ============================================
echo.
pause
