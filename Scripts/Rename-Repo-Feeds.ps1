<#
.SYNOPSIS
  WS1B Step 2a — re-point the auto-update feed references from the OLD GitHub
  repo name to a NEW one, across the agent/desktop/installer (this repo) and the
  citadel-cloud installer-download proxy.

.DESCRIPTION
  Renames ONLY the GitHub repo references that drive auto-update — plus the two
  updater tests and the "Report an Issue" link. It does NOT rename the GitHub
  repo, does NOT git commit/push, and deliberately leaves every machine anchor
  untouched (service name CitadelServer, install dir C:\Citadel, CitadelSetup-*.exe,
  Citadel.exe, appId cc.citadels.desktop, FIXED_SALT) — changing any of those
  orphans existing installs.

  RUN ORDER (do NOT reorder — see WS1B_REBRAND_RUNBOOK.md section 2):
    1. Run THIS script (edits the refs + runs the two updater tests).
    2. Commit and ship ONE release from the OLD repo name, so an existing user's
       next auto-update already knows the new feed.
    3. Rename the repo on GitHub (Settings -> Repository name).
    4. Coolify: set GITHUB_REPO=Sk3tch-Dev-Ux/<new> and redeploy citadel-cloud.
    5. From a machine on the PREVIOUS release, verify both the agent self-update
       and the desktop electron-updater pull the next version from the new repo.

  Applying these edits BEFORE the GitHub rename (step 3) would point deployed
  agents at a repo that doesn't exist yet — that is why step 1 ships from the
  OLD name first.

.PARAMETER NewRepo
  New GitHub repo name (owner stays Sk3tch-Dev-Ux). Default: citadel-server-manager

.PARAMETER AgentRepo
  Path to this (DayzServerController) repo. Default: this script's repo root.

.PARAMETER CloudRepo
  Path to the citadel-cloud repo. Default: sibling 'citadel-cloud' folder.

.PARAMETER DryRun
  Preview the changes without writing any files or running tests.

.PARAMETER SkipTests
  Apply the edits but skip the backend updater-test verification.

.EXAMPLE
  pwsh Scripts/Rename-Repo-Feeds.ps1 -DryRun
  pwsh Scripts/Rename-Repo-Feeds.ps1 -NewRepo citadel-server-manager
#>
[CmdletBinding()]
param(
  [string]$NewRepo = 'citadel-server-manager',
  [string]$AgentRepo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$CloudRepo,
  [switch]$DryRun,
  [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$OldRepo = 'DayzServerController'

if (-not $CloudRepo) {
  $CloudRepo = Join-Path (Split-Path $AgentRepo -Parent) 'citadel-cloud'
}

# Curated FUNCTIONAL targets only (auto-update feed + the matching tests +
# the issue link). Docs / comments that merely mention the old name (README,
# AUDIT_*.md, citadel-bridge.js header, etc.) are intentionally left for an
# optional separate sweep — they don't affect auto-update behaviour.
$agentFiles = @(
  'backend/lib/agent-updater.js',            # RELEASE_PATH_PREFIX (self-update download allowlist)
  'backend/tests/agent-updater.test.js',     # asserted download URLs
  'backend/tests/update-checker-url.test.js', # asserted download URL
  'desktop/src/auto-updater.js',             # FEED_REPO (electron-updater setFeedURL)
  'desktop/src/menu.js',                     # "Report an Issue" GitHub link
  'desktop/package.json',                    # build.publish.repo
  'installer/build.js'                       # app-update.yml repo:
)
$cloudFiles = @(
  'packages/api/src/config.ts',              # default GITHUB_REPO (installer-download proxy)
  '.env.example',
  '.env.production.example'
)

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Repoint([string]$root, [string[]]$files) {
  $changed = 0
  if (-not (Test-Path $root)) {
    Write-Warning "  repo not found: $root (skipping all of its files)"
    return 0
  }
  foreach ($rel in $files) {
    $full = Join-Path $root $rel
    if (-not (Test-Path $full)) { Write-Warning "  skip (not found): $rel"; continue }
    $text  = Get-Content -LiteralPath $full -Raw
    $count = ([regex]::Matches($text, [regex]::Escape($OldRepo))).Count
    if ($count -eq 0) {
      Write-Host "  ok, already renamed / no ref: $rel" -ForegroundColor DarkGray
      continue
    }
    $changed += $count
    if ($DryRun) {
      Write-Host ("  would re-point {0,2}x : {1}" -f $count, $rel) -ForegroundColor Yellow
    } else {
      [System.IO.File]::WriteAllText($full, $text.Replace($OldRepo, $NewRepo), $utf8NoBom)
      Write-Host ("  re-pointed   {0,2}x : {1}" -f $count, $rel) -ForegroundColor Green
    }
  }
  return $changed
}

Write-Host ""
Write-Host "WS1B feed re-point : '$OldRepo' -> '$NewRepo'  (owner Sk3tch-Dev-Ux unchanged)" -ForegroundColor Cyan
if ($DryRun) { Write-Host "DRY RUN — no files written, no tests run." -ForegroundColor Yellow }
else {
  Write-Host "!! Run order matters: ship ONE release from the OLD name, THEN rename the repo," -ForegroundColor Yellow
  Write-Host "   THEN update Coolify. Applying these refs before the GitHub rename breaks updates." -ForegroundColor Yellow
}

Write-Host "`nAgent repo : $AgentRepo" -ForegroundColor White
$a = Repoint $AgentRepo $agentFiles
Write-Host "`nCloud repo : $CloudRepo" -ForegroundColor White
$c = Repoint $CloudRepo $cloudFiles
Write-Host "`nReferences re-pointed: $($a + $c)" -ForegroundColor Cyan

if (-not $DryRun -and -not $SkipTests) {
  Write-Host "`nVerifying the two updater tests (must pass before tagging)..." -ForegroundColor Cyan
  Push-Location (Join-Path $AgentRepo 'backend')
  try {
    $env:JWT_SECRET = 'ci-test-secret'
    $env:NODE_ENV   = 'test'
    & npm test -- agent-updater update-checker-url
    if ($LASTEXITCODE -ne 0) { throw "Updater tests FAILED after the re-point — review before proceeding." }
    Write-Host "Updater tests passed." -ForegroundColor Green
  } finally { Pop-Location }
}

Write-Host "`nNEXT — MANUAL steps (owner only):" -ForegroundColor Cyan
Write-Host "  1. Review the diff, commit, and tag/ship one release from the OLD repo name."
Write-Host "  2. GitHub -> Settings -> rename the repo to '$NewRepo'."
Write-Host "  3. Coolify -> set GITHUB_REPO=Sk3tch-Dev-Ux/$NewRepo on citadel-cloud and redeploy."
Write-Host "  4. From a machine on the PREVIOUS release, confirm the agent self-update AND the"
Write-Host "     desktop electron-updater both pull the next version from the renamed repo."
Write-Host "`nOptional later: a docs/comment sweep (README, AUDIT_*.md, citadel-bridge.js header)" -ForegroundColor DarkGray
Write-Host "  still mention '$OldRepo' — cosmetic only; not required for auto-update." -ForegroundColor DarkGray
Write-Host "Machine anchors left untouched: CitadelServer service, C:\Citadel, CitadelSetup-*.exe," -ForegroundColor DarkGray
Write-Host "  Citadel.exe, appId cc.citadels.desktop, FIXED_SALT." -ForegroundColor DarkGray
