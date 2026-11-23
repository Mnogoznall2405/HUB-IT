param(
    [string]$ProjectRoot = "C:\Project\Image_scan",
    [string]$IisSitePath = "C:\inetpub\wwwroot\itinvent",
    [string]$CanonicalHost = 'hubit.zsgp.ru',
    [switch]$Mirror,
    [switch]$FreshInstall,
    # Optional .env to inject into ProjectRoot for the build when it is missing
    # there (e.g. building from a git worktree, where .env is not checked out).
    [string]$EnvFile,
    # Copy-only deploy: publish the already-built dist to IIS without npm install/build.
    [switch]$CopyOnly
)

$ErrorActionPreference = "Stop"

# The default root is a junction (C:\Project\Image_scan -> C:\Project\HUB-IT-main);
# resolve it or Vite computes index.html paths outside the real tree and fails.
$rootItem = Get-Item -LiteralPath $ProjectRoot
if ($rootItem.LinkType -in 'Junction','SymbolicLink' -and $rootItem.Target) {
    $ProjectRoot = @($rootItem.Target)[0]
    Write-Host "ProjectRoot resolved to $ProjectRoot" -ForegroundColor Cyan
}

function Add-ProjectNodeToPath {
    param([string]$Root)

    $bundledNode = Join-Path $Root "tools\node-v24.14.0-win-x64-full"
    if (-not (Test-Path $bundledNode)) {
        return
    }

    $nodeExe = Join-Path $bundledNode "node.exe"
    if (-not (Test-Path $nodeExe)) {
        return
    }

    if ($env:PATH -notlike "*$bundledNode*") {
        $env:PATH = "$bundledNode;$env:PATH"
    }
}

function Invoke-Npm {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    Write-Host "> npm $($Arguments -join ' ')"
    npm @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "npm $($Arguments[0]) failed with exit code $LASTEXITCODE"
    }
}

function Install-FrontendDependencies {
    param(
        [string]$FrontendPath,
        [bool]$ForceFreshInstall
    )

    $viteBin = Join-Path $FrontendPath "node_modules\vite\bin\vite.js"

    if ($ForceFreshInstall) {
        Write-Host "Fresh install requested: npm ci"
        try {
            Invoke-Npm -Arguments @("ci")
            return
        } catch {
            Write-Warning "npm ci failed ($($_.Exception.Message)); falling back to npm install"
        }
    }

    if (Test-Path $viteBin) {
        Write-Host "Frontend dependencies look ready; skipping install (pass -FreshInstall to force npm ci)"
        return
    }

    Write-Host "Installing frontend dependencies: npm install"
    Invoke-Npm -Arguments @("install", "--no-audit", "--no-fund")
}

function Invoke-RobocopyDeploy {
    param(
        [string]$Source,
        [string]$Destination,
        [bool]$UseMirror
    )

    if ($UseMirror) {
        Write-Host "Copy dist -> IIS site path (mirror): $Destination"
        robocopy $Source $Destination /MIR /R:2 /W:2 | Out-Null
    } else {
        Write-Host "Copy dist -> IIS site path: $Destination"
        robocopy $Source $Destination /E /R:2 /W:2 | Out-Null
    }

    # Robocopy uses exit codes 0-7 for success variants.
    if ($LASTEXITCODE -ge 8) {
        throw "robocopy failed with exit code $LASTEXITCODE"
    }
}

function Set-CanonicalHostInWebConfig {
    param(
        [Parameter(Mandatory = $true)]
        [string]$WebConfigPath,
        [Parameter(Mandatory = $true)]
        [string]$HostName
    )

    $normalizedHost = $HostName.Trim().ToLowerInvariant()
    if ($normalizedHost -notmatch '^[a-z0-9.-]+$') {
        throw 'CanonicalHost may contain only letters, digits, dots, and hyphens.'
    }

    $content = Get-Content -LiteralPath $WebConfigPath -Raw
    $expectedRedirect = "https://$normalizedHost/{R:1}"
    if ($content -like '*__HUBIT_CANONICAL_HOST__*') {
        $content.Replace('__HUBIT_CANONICAL_HOST__', $normalizedHost) |
            Set-Content -LiteralPath $WebConfigPath -Encoding utf8
        return
    }

    if ($content -notlike "*$expectedRedirect*") {
        throw "web.config canonical redirect is unexpected: $WebConfigPath"
    }
}

Add-ProjectNodeToPath -Root $ProjectRoot

$frontendPath = Join-Path $ProjectRoot "WEB-itinvent\frontend"
$distPath = Join-Path $frontendPath "dist"
$distIndexPath = Join-Path $distPath "index.html"

if (-not (Test-Path $frontendPath)) {
    throw "Frontend path not found: $frontendPath"
}

if ($CopyOnly) {
    Write-Host "CopyOnly: skip npm install/build, publishing existing dist"
} else {
    Write-Host "Build frontend in: $frontendPath"
    # vite.config.js resolves envDir to the repo root (frontend/../..): every
    # VITE_* feature flag (chat, mail, ...) silently compiles to "off" when
    # .env is absent there. Guard so a build from a worktree or a foreign
    # path cannot silently publish a bundle with all modules disabled.
    $rootEnvPath = Join-Path $ProjectRoot ".env"
    $envFileProvisioned = $false
    if (-not (Test-Path $rootEnvPath)) {
        if ($EnvFile) {
            if (-not (Test-Path $EnvFile)) {
                throw "EnvFile not found: $EnvFile"
            }
            Copy-Item -LiteralPath $EnvFile -Destination $rootEnvPath
            $envFileProvisioned = $true
            Write-Host "EnvFile provisioned at $rootEnvPath for this build"
        } else {
            throw "Vite env file not found: $rootEnvPath. The frontend reads VITE_* feature flags (VITE_CHAT_ENABLED, VITE_MAIL_MODULE_ENABLED, ...) from the repo-root .env at build time; building without it silently disables those modules in the published bundle. Pass -EnvFile <path-to-.env> or restore .env in the project root."
        }
    }
    $previousCanonicalHost = $env:VITE_CANONICAL_HOST
    $hadCanonicalHost = Test-Path 'Env:VITE_CANONICAL_HOST'
    $env:VITE_CANONICAL_HOST = $CanonicalHost
    Push-Location $frontendPath
    try {
        Install-FrontendDependencies -FrontendPath $frontendPath -ForceFreshInstall:$FreshInstall.IsPresent
        Invoke-Npm -Arguments @("run", "build")
    }
    finally {
        Pop-Location
        if ($envFileProvisioned) {
            Remove-Item -LiteralPath $rootEnvPath -Force -ErrorAction SilentlyContinue
        }
        if ($hadCanonicalHost) {
            $env:VITE_CANONICAL_HOST = $previousCanonicalHost
        } else {
            Remove-Item 'Env:VITE_CANONICAL_HOST' -ErrorAction SilentlyContinue
        }
    }
}

if (-not (Test-Path $distIndexPath)) {
    throw "Build output not found: $distIndexPath"
}

Set-CanonicalHostInWebConfig -WebConfigPath (Join-Path $distPath 'web.config') -HostName $CanonicalHost

New-Item -ItemType Directory -Force $IisSitePath | Out-Null
Invoke-RobocopyDeploy -Source $distPath -Destination $IisSitePath -UseMirror:$Mirror.IsPresent

Write-Host "Frontend published to IIS path: $IisSitePath"
Write-Host "Note: web.config in dist sets maxAllowedContentLength to the IIS uint32 maximum for My Files uploads. Recycle IIS app pool if uploads still return 413."
