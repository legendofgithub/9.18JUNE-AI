@echo off
setlocal
cd /d "%~dp0"

echo [1/5] Installing build dependencies...
".venv\Scripts\python.exe" -m pip install -r requirements-build.txt
if errorlevel 1 goto :error

echo [2/5] Building frontend...
pushd frontend
call npm run build
if errorlevel 1 goto :error_popd
popd

echo [3/5] Packaging JuneAI.exe...
".venv\Scripts\pyinstaller.exe" JuneAI.spec --noconfirm --clean
if errorlevel 1 goto :error

echo [4/5] Creating distributable zip...
powershell -NoProfile -Command "Compress-Archive -LiteralPath 'dist\JuneAI' -DestinationPath 'dist\JuneAI-Windows-x64.zip' -Force"
if errorlevel 1 goto :error

echo [5/5] Done.
echo EXE: %CD%\dist\JuneAI\JuneAI.exe
echo ZIP: %CD%\dist\JuneAI-Windows-x64.zip
exit /b 0

:error_popd
popd
:error
echo Build failed.
exit /b 1
