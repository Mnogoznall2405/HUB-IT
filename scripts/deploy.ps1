<#
.SYNOPSIS
    HUB-IT deploy: frontend publish (build + IIS) + backend restart + health check.

.DESCRIPTION
    Single entry point so a deploy is one command instead of three scripts.
    Default flow:
      1. scripts/iis/publish_frontend_iis.ps1  (npm build -> robocopy dist -> C:\inetpub\wwwroot\itinvent)
      2. scripts/pm2/restart-all.ps1 -SaveState (full PM2 restart, incl. chat/scan/workers)
      3. scripts/pm2/health-check.ps1          (read-only post-check)

.EXAMPLE
    scripts\deploy.ps1                  # полный цикл: фронт + рестарт всего + пост-чек
    scripts\deploy.ps1 -FrontendOnly    # только собрать и опубликовать фронт
    scripts\deploy.ps1 -BackendOnly     # только рестарт бэкенда + пост-чек
    scripts\deploy.ps1 -LightRestart    # restart-backend.ps1 вместо restart-all (без pm2 kill)
    scripts\deploy.ps1 -DryRun          # показать шаги, ничего не выполнять
#>
param(
    [switch]$FrontendOnly,
    [switch]$BackendOnly,
    [switch]$LightRestart,
    [switch]$SkipHealthCheck,
    [switch]$DryRun,
    [ValidateSet('auto', 'single', 'dual')][string]$ChatMode = 'auto'
)

$ErrorActionPreference = 'Stop'
$scriptsRoot = $PSScriptRoot

if ($FrontendOnly -and $BackendOnly) { throw '-FrontendOnly and -BackendOnly are mutually exclusive.' }
if ($FrontendOnly -and $LightRestart) { throw '-FrontendOnly and -LightRestart are mutually exclusive.' }

$doFrontend = -not $BackendOnly
$doBackend = -not $FrontendOnly
$script:step = 0

function Write-Step([string]$Message) {
    $script:step += 1
    Write-Host "`n=== [$script:step] $Message ===" -ForegroundColor Cyan
}

function Invoke-Step {
    param([string]$ScriptPath, [string[]]$Arguments = @())
    # Do not check $LASTEXITCODE here: it leaks from the child's last native call
    # (robocopy exits 0-7 on success). Failures inside child scripts surface as
    # thrown errors, which $ErrorActionPreference='Stop' turns terminating.
    & $ScriptPath @Arguments
}

$publishScript = Join-Path $scriptsRoot 'iis\publish_frontend_iis.ps1'
$restartAllScript = Join-Path $scriptsRoot 'pm2\restart-all.ps1'
$restartBackendScript = Join-Path $scriptsRoot 'pm2\restart-backend.ps1'
$healthCheckScript = Join-Path $scriptsRoot 'pm2\health-check.ps1'

if ($DryRun) {
    Write-Host '[DryRun] planned steps:' -ForegroundColor Yellow
    if ($doFrontend) { Write-Host "  1. $publishScript" }
    if ($doBackend) {
        if ($LightRestart) {
            Write-Host "  2. $restartBackendScript"
        } else {
            Write-Host "  2. $restartAllScript -SaveState -ChatMode $ChatMode"
        }
    }
    if (-not $SkipHealthCheck) { Write-Host "  3. $healthCheckScript (read-only)" }
    return
}

if ($doFrontend) {
    Write-Step 'Frontend: npm build + publish to IIS (C:\inetpub\wwwroot\itinvent)'
    Invoke-Step -ScriptPath $publishScript
}

if ($doBackend) {
    if ($LightRestart) {
        Write-Step 'Backend: restart-backend.ps1 (backend + scan only)'
        Invoke-Step -ScriptPath $restartBackendScript
    } else {
        Write-Step "Backend: restart-all.ps1 -SaveState -ChatMode $ChatMode"
        Invoke-Step -ScriptPath $restartAllScript -Arguments @('-SaveState', '-ChatMode', $ChatMode)
    }
}

if (-not $SkipHealthCheck) {
    Write-Step 'Post-check: health-check.ps1 (read-only)'
    Invoke-Step -ScriptPath $healthCheckScript
}

Write-Host "`nDeploy finished." -ForegroundColor Green
