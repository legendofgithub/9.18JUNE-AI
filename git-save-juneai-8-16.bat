@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo  Save JuneAI version as JuneAI-8-16
echo ============================================

if not exist .git (
  echo Initializing git repository...
  git init
)

git add -A
git commit -m "JuneAI-8-16"

git tag -a JuneAI-8-16 -m "JuneAI 8-16 product version"

echo.
echo Done. Current version has been saved as tag: JuneAI-8-16
echo.
pause
