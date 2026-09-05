param(
    [string]$ProjectRoot = "C:\Project\Image_scan",
    [string]$IisSitePath = "C:\inetpub\wwwroot\itinvent",
    [string]$CanonicalHost = 'hubit.zsgp.ru',
    [switch]$Mirror,
    [switch]$FreshInstall
)

$ErrorActionPreference = "Stop"

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

Write-Host "Build frontend in: $frontendPath"
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
    if ($hadCanonicalHost) {
        $env:VITE_CANONICAL_HOST = $previousCanonicalHost
    } else {
        Remove-Item 'Env:VITE_CANONICAL_HOST' -ErrorAction SilentlyContinue
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
