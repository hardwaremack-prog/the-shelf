@echo off
echo Starting The Shelf setup...
node "%~dp0install.js"
if errorlevel 1 (
  echo.
  echo Something went wrong. Make sure Node.js is installed: https://nodejs.org
  pause
)
