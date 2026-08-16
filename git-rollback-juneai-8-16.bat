@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo  Rollback to JuneAI-8-16
echo ============================================
echo.
echo  This will switch to the saved version.
echo  If you have uncommitted changes, please back them up first.
echo.

git checkout JuneAI-8-16

echo.
echo  You are now on JuneAI-8-16.
echo  If you want to keep working on this version, create a new branch:
echo    git checkout -b rollback-juneai-8-16
echo.
pause
