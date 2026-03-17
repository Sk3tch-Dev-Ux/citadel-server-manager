#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Citadel DayZ Server Controller — Service Installer
.DESCRIPTION
    Installs Citadel as a Windows service using NSSM.
    Run this script as Administrator after extracting the zip.
#>

param(
    [string]$InstallDir = "C:\Citadel"
)

$ErrorActionPreference = "Stop"
$ServiceName = "CitadelServer"
$ServiceDisplay = "Citadel DayZ Server Controller"

Write-Host ""
Write-Host "  ======================================" -ForegroundColor Cyan
Write-Host "    Citadel Server Controller Installer" -ForegroundColor Cyan
Write-Host "  ======================================" -ForegroundColor Cyan
Write-Host ""

# Determine source directory (where this script is located)
$SourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Check required files exist
$requiredFiles = @("citadel-node.exe", "citadel-server.js", "nssm.exe")
foreach ($f in $requiredFiles) {
    if (-not (Test-Path (Join-Path $SourceDir $f))) {
        Write-Host "  ERROR: Required file '$f' not found in $SourceDir" -ForegroundColor Red
        Write-Host "  Make sure you extracted the full zip archive." -ForegroundColor Yellow
        exit 1
    }
}

# Copy files to install directory (if not already there)
if ($SourceDir -ne $InstallDir) {
    Write-Host "  Installing to $InstallDir..." -ForegroundColor White

    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }

    # Copy all files, preserving existing data/ and .env
    $items = Get-ChildItem -Path $SourceDir
    foreach ($item in $items) {
        $destPath = Join-Path $InstallDir $item.Name

        # Don't overwrite data directory or .env on upgrade
        if ($item.Name -eq "data" -and (Test-Path $destPath)) {
            Write-Host "  Preserving existing data/ directory" -ForegroundColor Yellow
            continue
        }
        if ($item.Name -eq ".env" -and (Test-Path $destPath)) {
            Write-Host "  Preserving existing .env file" -ForegroundColor Yellow
            continue
        }

        if ($item.PSIsContainer) {
            Copy-Item -Path $item.FullName -Destination $destPath -Recurse -Force
        } else {
            Copy-Item -Path $item.FullName -Destination $destPath -Force
        }
    }
    Write-Host "  Files copied." -ForegroundColor Green
} else {
    Write-Host "  Running from install directory." -ForegroundColor White
}

# Ensure data directory exists
$dataDir = Join-Path $InstallDir "data"
if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    Write-Host "  Created data/ directory" -ForegroundColor Green
}

# Copy .env.example to .env if no .env exists
$envFile = Join-Path $InstallDir ".env"
$envExample = Join-Path $InstallDir ".env.example"
if (-not (Test-Path $envFile) -and (Test-Path $envExample)) {
    Copy-Item -Path $envExample -Destination $envFile
    Write-Host "  Created .env from template" -ForegroundColor Green
}

# Paths
$NodeExe = Join-Path $InstallDir "citadel-node.exe"
$ServerJs = Join-Path $InstallDir "citadel-server.js"
$NssmExe = Join-Path $InstallDir "nssm.exe"
$LogFile = Join-Path $dataDir "service.log"

# Stop existing service if running
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "  Stopping existing service..." -ForegroundColor Yellow
    & $NssmExe stop $ServiceName 2>$null
    & $NssmExe remove $ServiceName confirm 2>$null
    Start-Sleep -Seconds 2
}

# Install the service
Write-Host "  Registering Windows service..." -ForegroundColor White
& $NssmExe install $ServiceName $NodeExe $ServerJs
& $NssmExe set $ServiceName DisplayName $ServiceDisplay
& $NssmExe set $ServiceName Description "Citadel - All-In-One DayZ server management platform"
& $NssmExe set $ServiceName AppDirectory $InstallDir
& $NssmExe set $ServiceName Start SERVICE_AUTO_START

# Environment variables
& $NssmExe set $ServiceName AppEnvironmentExtra "CITADEL_SERVICE_MODE=1" "CITADEL_INSTALL_DIR=$InstallDir" "NODE_ENV=production"

# Logging
& $NssmExe set $ServiceName AppStdout $LogFile
& $NssmExe set $ServiceName AppStderr $LogFile
& $NssmExe set $ServiceName AppStdoutCreationDisposition 4
& $NssmExe set $ServiceName AppStderrCreationDisposition 4
& $NssmExe set $ServiceName AppRotateFiles 1
& $NssmExe set $ServiceName AppRotateBytes 5242880

# Crash recovery — prevent PAUSED state
& $NssmExe set $ServiceName AppThrottle 5000
& $NssmExe set $ServiceName AppRestartDelay 3000
& $NssmExe set $ServiceName AppExit Default Restart

# Windows failure recovery
& sc.exe failure $ServiceName reset= 86400 actions= restart/60000/restart/60000/restart/60000

Write-Host "  Service registered." -ForegroundColor Green

# Start the service
Write-Host "  Starting service..." -ForegroundColor White
& $NssmExe start $ServiceName

Start-Sleep -Seconds 3

# Verify
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-Host ""
    Write-Host "  SUCCESS! Citadel is running." -ForegroundColor Green
    Write-Host "  Dashboard: http://localhost:3001" -ForegroundColor Cyan
    Write-Host "  Service log: $LogFile" -ForegroundColor Gray
    Write-Host ""

    # Open browser
    Start-Process "http://localhost:3001"
} else {
    Write-Host ""
    Write-Host "  WARNING: Service may not have started correctly." -ForegroundColor Yellow
    Write-Host "  Check the log: $LogFile" -ForegroundColor Yellow
    Write-Host ""
}
