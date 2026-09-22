# TypeWriter - PowerShell Wrapper
# Usage: .\typewriter.ps1 [options] [file]
#
# If Windows blocks this script (ExecutionPolicy), run once from an
# elevated PowerShell:
#   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
# Or bypass for a single run without changing policy:
#   powershell -ExecutionPolicy Bypass -File .\typewriter.ps1 --help
# Requires: PowerShell 5.1+ (ships with Windows 10/11) and Node.js 18+.

param(
    [string]$File,
    [switch]$Login,
    [switch]$Logout,
    [switch]$Status,
    [switch]$Push,
    [switch]$Serve,
    [string]$Port,
    [string]$Host,
    [switch]$Themes,
    [string]$Theme,
    [switch]$Help,
    [switch]$Version
)

$ErrorActionPreference = 'Stop'

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "Error: Node.js not found. Install Node.js 18+ from https://nodejs.org, then reopen PowerShell." -ForegroundColor Red
    exit 1
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$NodeApp = Join-Path $ScriptDir "dist\index.js"

if (-not (Test-Path -LiteralPath $NodeApp)) {
    Write-Host "Error: TypeWriter not built. Run 'npm run build' first." -ForegroundColor Red
    exit 1
}

$nodeArgs = @()
if ($Login)   { $nodeArgs += "--login" }
if ($Logout)  { $nodeArgs += "--logout" }
if ($Status)  { $nodeArgs += "--status" }
if ($Push)    { $nodeArgs += "--push" }
if ($Serve)   { $nodeArgs += "--serve" }
if ($Port)    { $nodeArgs += "--port=$Port" }
if ($Host)    { $nodeArgs += "--host=$Host" }
if ($Themes)  { $nodeArgs += "--themes" }
if ($Theme)   { $nodeArgs += "--theme"; $nodeArgs += $Theme }
if ($Help)    { $nodeArgs += "--help" }
if ($Version) { $nodeArgs += "--version" }
if ($File)    { $nodeArgs += $File }

& $nodeCmd.Source $NodeApp @nodeArgs
exit $LASTEXITCODE
