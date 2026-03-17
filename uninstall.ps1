#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Citadel DayZ Server Controller — Service Uninstaller
.DESCRIPTION
    Stops and removes the Citadel Windows service.
    Optionally removes installation files (preserves data/ by default).
#>

param(
    [string]$InstallDir = "C:\Citadel",
    [switch]$RemoveFiles
)

$ErrorActionPreference = "Stop"
$ServiceName = "CitadelServer"

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host "    Citadel Server Controller Uninstaller" -ForegroundColor Cyan
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host ""

$NssmExe = Join-Path $InstallDir "nssm.exe"

# Stop and remove service
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
    Write-Host "  Stopping service..." -ForegroundColor Yellow
    if (Test-Path $NssmExe) {
        & $NssmExe stop $ServiceName 2>$null
        Start-Sleep -Seconds 2
        & $NssmExe remove $ServiceName confirm 2>$null
    } else {
        sc.exe stop $ServiceName 2>$null
        Start-Sleep -Seconds 2
        sc.exe delete $ServiceName 2>$null
    }
    Write-Host "  Service removed." -ForegroundColor Green
} else {
    Write-Host "  Service not found (already removed)." -ForegroundColor Yellow
}

if ($RemoveFiles -and (Test-Path $InstallDir)) {
    Write-Host ""
    Write-Host "  Removing installation files..." -ForegroundColor Yellow
    Write-Host "  NOTE: data/ directory is preserved." -ForegroundColor Cyan

    # Remove everything except data/
    Get-ChildItem -Path $InstallDir | Where-Object { $_.Name -ne "data" } | ForEach-Object {
        Remove-Item -Path $_.FullName -Recurse -Force
    }
    Write-Host "  Files removed. Data preserved at: $InstallDir\data" -ForegroundColor Green
}

Write-Host ""
Write-Host "  Uninstall complete." -ForegroundColor Green
Write-Host ""
