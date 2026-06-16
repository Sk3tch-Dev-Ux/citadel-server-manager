<#
.SYNOPSIS
    Installs the shared AI design / code-graph "work chain" tools into your
    GLOBAL Claude config (~/.claude/skills), so they're available in every
    project — including the Citadel dashboard.

.DESCRIPTION
    Five of the six requested repos are AI "skills" or tools:

      * impeccable             frontend design language + 23 design commands
      * ui-ux-pro-max          UI/UX intelligence (styles, palettes, font pairs)
      * taste-skill            anti-slop premium frontend skill
      * huashu-design          HTML-native hi-fi prototypes / slides / animation
      * graphify               maps a repo into a queryable knowledge graph (/graphify)

    The sixth — microsoft/playwright — is NOT a skill. It's wired into this repo
    as the @playwright/test dev dependency (see package.json + playwright.config.js).
    Run `npm install && npx playwright install` to finish that part.

    LICENSE NOTE: huashu-design ships an MIT LICENSE file, but its README
    explicitly forbids commercial/enterprise use without the author's
    permission. Citadel is a commercial product, so it is SKIPPED by default.
    Pass -IncludeHuashu only if you've cleared its terms.

.PARAMETER All
    Install every skill found in each repo (taste-skill has 13, ui-ux-pro-max
    has 7). Default installs only the primary skill from each repo.

.PARAMETER IncludeHuashu
    Also install huashu-design (see license note above).

.PARAMETER Project
    Install into THIS project's .claude/skills instead of globally.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\setup-skills.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\setup-skills.ps1 -All -IncludeHuashu
#>

[CmdletBinding()]
param(
    [switch]$All,
    [switch]$IncludeHuashu,
    [switch]$Project
)

$ErrorActionPreference = 'Stop'
$scope = if ($Project) { '--project' } else { '--global' }
$scopeLabel = if ($Project) { 'project (.claude/skills)' } else { 'global (~/.claude/skills)' }

function Test-Cmd($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

Write-Host "==> Installing design skills to: $scopeLabel" -ForegroundColor Cyan

if (-not (Test-Cmd npx)) {
    throw "npx not found. Install Node.js 18+ from https://nodejs.org first."
}

# repo  =>  primary skill name (the install name from each repo's SKILL frontmatter)
$skills = [ordered]@{
    'pbakaus/impeccable'                   = 'impeccable'
    'nextlevelbuilder/ui-ux-pro-max-skill' = 'ui-ux-pro-max'
    'Leonxlnx/taste-skill'                 = 'design-taste-frontend'
}
if ($IncludeHuashu) { $skills['alchaincyf/huashu-design'] = 'huashu-design' }

foreach ($repo in $skills.Keys) {
    Write-Host "`n--- $repo ---" -ForegroundColor Yellow
    if ($All) {
        npx -y skills@latest add $repo $scope --skill '*' --yes
    } else {
        npx -y skills@latest add $repo $scope --skill $skills[$repo] --yes
    }
}

# --- graphify: a Python tool, not an npx skill ---
Write-Host "`n--- safishamsi/graphify (Python tool) ---" -ForegroundColor Yellow
$graphInstaller = $null
if     (Test-Cmd uv)   { $graphInstaller = 'uv tool install graphifyy' }
elseif (Test-Cmd pipx) { $graphInstaller = 'pipx install graphifyy' }

if ($graphInstaller) {
    Write-Host "Installing graphify via: $graphInstaller"
    Invoke-Expression $graphInstaller
    # Registers the /graphify skill into your Claude config:
    graphify install
    Write-Host "graphify ready. In Claude Code: /graphify .   (PowerShell: graphify .)"
} else {
    Write-Host "Skipped graphify: neither 'uv' nor 'pipx' found." -ForegroundColor Red
    Write-Host "  Install one, then run:  uv tool install graphifyy  (or: pipx install graphifyy)"
    Write-Host "  Then:  graphify install"
}

Write-Host "`n==> Done. Verify with:  npx skills list" -ForegroundColor Green
Write-Host "    Playwright (separate): npm install ; npx playwright install ; npm run test:e2e"
