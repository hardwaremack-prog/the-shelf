@echo off
title The Shelf - Setup
cd /d "%~dp0"
echo Starting The Shelf setup...
echo.

rem Double-clicking this file inside a zip runs it from a temp folder with
rem nothing else next to it. Catch that and say what to do.
if not exist "%~dp0install.js" goto :notextracted
if not exist "%~dp0..\server.js" goto :notextracted

where node >nul 2>nul
if errorlevel 1 goto :nonode

node "%~dp0install.js"
if errorlevel 1 (
  echo.
  echo Setup did not finish. The messages above say why.
  pause
)
goto :eof

:notextracted
echo It looks like this is running from inside the zip file.
echo Right-click the downloaded zip, choose "Extract All...", then open the
echo extracted folder, go into "installer" and double-click this file again.
echo.
pause
goto :eof

:nonode
echo Node.js is not installed (or not on the PATH).
echo Download the LTS version from https://nodejs.org and install it,
echo then double-click this file again.
echo.
pause
goto :eof
