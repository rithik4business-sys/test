@echo off
REM TypeWriter - Windows Batch Wrapper
REM Usage: typewriter.bat [options] [file]

set SCRIPT_DIR=%~dp0
set DIST_DIR=%SCRIPT_DIR%dist
set NODE_APP=%DIST_DIR%\index.js

if not exist "%NODE_APP%" (
    echo Error: TypeWriter not built. Run 'npm run build' first.
    exit /b 1
)

node "%NODE_APP%" %*
