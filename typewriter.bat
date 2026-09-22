@echo off
REM TypeWriter - Windows Batch Wrapper
REM Usage: typewriter.bat [options] [file]
REM Requires Node.js 18+. For full flag support use typewriter.ps1.

where node >nul 2>nul
if errorlevel 1 (
    echo Error: Node.js not found. Install Node.js 18+ from https://nodejs.org, then reopen your terminal.
    exit /b 1
)

set SCRIPT_DIR=%~dp0
set NODE_APP=%SCRIPT_DIR%dist\index.js

if not exist "%NODE_APP%" (
    echo Error: TypeWriter not built. Run 'npm run build' first.
    exit /b 1
)

node "%NODE_APP%" %*
exit /b %ERRORLEVEL%
