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

# Self-elevate to admin if not already
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "  Requesting administrator privileges..." -ForegroundColor Yellow
    $scriptPath = $MyInvocation.MyCommand.Path
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -InstallDir `"$InstallDir`""
    exit
}
$ServiceName = "CitadelServer"  # service control identity — upgrade anchor, do not rename
$ServiceDisplay = "Citadel Server Manager"

try {
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
            throw "Missing required file: $f"
        }
    }

    # Stop existing service BEFORE copying files (prevents file lock on node.exe during upgrade)
    $existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($existingService -and $existingService.Status -eq 'Running') {
        Write-Host "  Stopping existing service to allow file update..." -ForegroundColor Yellow
        try {
            Stop-Service -Name $ServiceName -Force -ErrorAction Stop
            # Wait for node.exe to actually exit (stop can return before the process dies)
            $deadline = (Get-Date).AddSeconds(30)
            while ((Get-Date) -lt $deadline) {
                $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
                if (-not $svc -or $svc.Status -ne 'Running') { break }
                Start-Sleep -Milliseconds 500
            }
            Write-Host "  Service stopped." -ForegroundColor Green
        } catch {
            Write-Host "  Warning: could not stop service gracefully: $($_.Exception.Message)" -ForegroundColor Yellow
            Write-Host "  Continuing — file copy may fail if binaries are locked." -ForegroundColor Yellow
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

    # Remove any existing service registration (already stopped above, if it existed)
    $existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($existingService) {
        Write-Host "  Removing existing service registration..." -ForegroundColor Yellow
        $ErrorActionPreference = "Continue"
        & $NssmExe remove $ServiceName confirm 2>&1 | Out-Null
        $ErrorActionPreference = "Stop"
        Start-Sleep -Seconds 1
    }

    # Install the service (NSSM writes status to stderr, so relax error handling)
    $ErrorActionPreference = "Continue"
    Write-Host "  Registering Windows service..." -ForegroundColor White
    & $NssmExe install $ServiceName $NodeExe $ServerJs 2>&1 | Out-Null
    & $NssmExe set $ServiceName DisplayName $ServiceDisplay 2>&1 | Out-Null
    & $NssmExe set $ServiceName Description "Citadel - All-In-One DayZ server management platform" 2>&1 | Out-Null
    & $NssmExe set $ServiceName AppDirectory $InstallDir 2>&1 | Out-Null
    & $NssmExe set $ServiceName Start SERVICE_AUTO_START 2>&1 | Out-Null

    # Environment variables
    & $NssmExe set $ServiceName AppEnvironmentExtra "CITADEL_SERVICE_MODE=1" "CITADEL_INSTALL_DIR=$InstallDir" "NODE_ENV=production" 2>&1 | Out-Null

    # Logging
    & $NssmExe set $ServiceName AppStdout $LogFile 2>&1 | Out-Null
    & $NssmExe set $ServiceName AppStderr $LogFile 2>&1 | Out-Null
    & $NssmExe set $ServiceName AppStdoutCreationDisposition 4 2>&1 | Out-Null
    & $NssmExe set $ServiceName AppStderrCreationDisposition 4 2>&1 | Out-Null
    & $NssmExe set $ServiceName AppRotateFiles 1 2>&1 | Out-Null
    & $NssmExe set $ServiceName AppRotateBytes 5242880 2>&1 | Out-Null

    # Crash recovery — prevent PAUSED state
    & $NssmExe set $ServiceName AppThrottle 5000 2>&1 | Out-Null
    & $NssmExe set $ServiceName AppRestartDelay 3000 2>&1 | Out-Null
    & $NssmExe set $ServiceName AppExit Default Restart 2>&1 | Out-Null

    # Windows failure recovery
    & sc.exe failure $ServiceName reset= 86400 actions= restart/60000/restart/60000/restart/60000 2>&1 | Out-Null
    $ErrorActionPreference = "Stop"

    Write-Host "  Service registered." -ForegroundColor Green

    # Start the service
    Write-Host "  Starting service..." -ForegroundColor White
    $ErrorActionPreference = "Continue"
    & $NssmExe start $ServiceName 2>&1 | Out-Null
    $ErrorActionPreference = "Stop"

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
} catch {
    Write-Host ""
    Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  $($_.ScriptStackTrace)" -ForegroundColor DarkGray
    Write-Host ""
}

Write-Host ""
Write-Host "  Press any key to exit..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
