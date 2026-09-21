# TypeWriter - PowerShell Wrapper
# Usage: .\typewriter.ps1 [options] [file]

param(
    [string]$File,
    [switch]$Login,
    [switch]$Logout,
    [switch]$Status,
    [switch]$Push,
    [switch]$Help,
    [switch]$Version
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DistDir = Join-Path $ScriptDir "dist"
$NodeApp = Join-Path $DistDir "index.js"

if (-not (Test-Path $NodeApp)) {
    Write-Host "Error: TypeWriter not built. Run 'npm run build' first." -ForegroundColor Red
    exit 1
}

$nodeArgs = @()

if ($Login) { $nodeArgs += "--login" }
if ($Logout) { $nodeArgs += "--logout" }
if ($Status) { $nodeArgs += "--status" }
if ($Push) { $nodeArgs += "--push" }
if ($Help) { $nodeArgs += "--help" }
if ($Version) { $nodeArgs += "--version" }
if ($File) { $nodeArgs += $File }

node $NodeApp @nodeArgs
