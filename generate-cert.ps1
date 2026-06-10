<#
.SYNOPSIS
  Generate a self-signed TLS certificate for local Citadel Agent HTTPS.
.DESCRIPTION
  Writes cert\key.pem + cert\cert.pem next to this script (the files
  backend/server.js loads at startup from <ROOT>/cert/). Self-signed certs
  are for LOCAL / LAN / test use only -- browsers will show a warning. For a
  public, internet-facing deployment use a real CA-issued certificate or
  terminate TLS at a reverse proxy. See TLS_SETUP.md.
.PARAMETER Hostname
  CN / primary SAN for the cert. Defaults to "localhost".
.PARAMETER Days
  Validity in days. Defaults to 825 (max most browsers accept for leaf certs).
.EXAMPLE
  .\generate-cert.ps1
.EXAMPLE
  .\generate-cert.ps1 -Hostname dayz.example.com
#>
param(
  [string]$Hostname = "localhost",
  [int]$Days = 825,
  [string]$CertDir = (Join-Path $PSScriptRoot "cert")
)

$ErrorActionPreference = "Stop"

# Locate openssl: PATH first, then the copy bundled with Git for Windows.
$openssl = (Get-Command openssl -ErrorAction SilentlyContinue).Source
if (-not $openssl) {
  foreach ($p in @(
      "$env:ProgramFiles\Git\usr\bin\openssl.exe",
      "${env:ProgramFiles(x86)}\Git\usr\bin\openssl.exe")) {
    if (Test-Path $p) { $openssl = $p; break }
  }
}
if (-not $openssl) {
  Write-Error ("openssl was not found. Install Git for Windows (it bundles openssl), " +
    "or add openssl to PATH. A manual alternative is documented in TLS_SETUP.md.")
  exit 1
}

New-Item -ItemType Directory -Path $CertDir -Force | Out-Null
$key = Join-Path $CertDir "key.pem"
$crt = Join-Path $CertDir "cert.pem"

if ((Test-Path $key) -or (Test-Path $crt)) {
  Write-Warning "cert\key.pem or cert\cert.pem already exists. Overwriting."
}

# SAN covers the hostname plus loopback so localhost and 127.0.0.1 both validate.
$san = "subjectAltName=DNS:$Hostname,DNS:localhost,IP:127.0.0.1"

& $openssl req -x509 -newkey rsa:2048 -nodes `
  -keyout $key -out $crt -days $Days `
  -subj "/CN=$Hostname" -addext $san
if ($LASTEXITCODE -ne 0) { Write-Error "openssl failed (exit $LASTEXITCODE)"; exit 1 }

Write-Host ""
Write-Host "TLS certificate generated:" -ForegroundColor Green
Write-Host "  $key"
Write-Host "  $crt"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Restart the Citadel Agent. The startup banner should now show https://"
Write-Host "  2. To REQUIRE https (refuse to boot if certs are missing), set in"
Write-Host "     citadel.config.json:  { ""server"": { ""requireHttps"": true } }"
Write-Host "     or environment:       REQUIRE_HTTPS=true"
Write-Host ""
Write-Host "Self-signed certs trigger browser warnings -- expected for local/LAN use."
Write-Host "For public deployments see TLS_SETUP.md (real CA cert or TLS-terminating proxy)."
