# Deployment script for Citadel (Windows)
# Usage: .\deploy.ps1 [-Force] [-SkipBuild]

param(
    [switch]$Force,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

Write-Host "=== Citadel Deployment ===" -ForegroundColor Cyan

# ─── Stop only the Citadel process (not all Node processes) ─────
$pidFile = Join-Path $ScriptDir "citadel.pid"
if (Test-Path $pidFile) {
    $pid = Get-Content $pidFile
    try {
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -eq "node") {
            Write-Host "Stopping Citadel (PID $pid)..." -ForegroundColor Yellow
            Stop-Process -Id $pid -Force
            Start-Sleep -Seconds 2
        }
    } catch {
        Write-Host "Previous process already stopped." -ForegroundColor Gray
    }
    Remove-Item $pidFile -Force
} else {
    Write-Host "No PID file found — assuming fresh start." -ForegroundColor Gray
}

# ─── Pull latest code ──────────────────────────────────────────
if (-not $Force) {
    Write-Host "Pulling latest code..." -ForegroundColor Cyan
    git pull
    if ($LASTEXITCODE -ne 0) { throw "git pull failed" }
}

# ─── Install backend dependencies ──────────────────────────────
Write-Host "Installing backend dependencies..." -ForegroundColor Cyan
npm install --production
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

# ─── Build frontend ────────────────────────────────────────────
if (-not $SkipBuild) {
    $frontendPath = Join-Path $ScriptDir "..\web\frontend"
    if (Test-Path (Join-Path $frontendPath "package.json")) {
        Write-Host "Building frontend..." -ForegroundColor Cyan
        Push-Location $frontendPath
        npm install
        if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Frontend npm install failed" }
        npm run build
        if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Frontend build failed" }
        Pop-Location
    }
} else {
    Write-Host "Skipping frontend build (--SkipBuild)" -ForegroundColor Gray
}

# ─── Start server ──────────────────────────────────────────────
Write-Host "Starting Citadel..." -ForegroundColor Green
$proc = Start-Process -NoNewWindow -PassThru -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $ScriptDir
$proc.Id | Out-File $pidFile -Encoding ascii

Write-Host "Citadel started (PID $($proc.Id))" -ForegroundColor Green
Write-Host "PID saved to $pidFile" -ForegroundColor Gray
