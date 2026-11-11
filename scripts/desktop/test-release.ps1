[CmdletBinding()]
param(
    [switch]$NoRestore,
    [switch]$SkipFrontend,
    [switch]$SkipInstaller
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$dotnet = Join-Path $repoRoot 'tools\dotnet-sdk-8\dotnet.exe'
$solution = Join-Path $repoRoot 'desktop\Hub.Desktop.sln'
$testProject = Join-Path $repoRoot 'desktop\Hub.Desktop.Tests\Hub.Desktop.Tests.csproj'
$buildInstaller = Join-Path $PSScriptRoot 'build-installer.ps1'
$testDependencies = Join-Path $PSScriptRoot 'test-dependencies.ps1'
$validatePolicyTemplates = Join-Path $PSScriptRoot 'validate-policy-templates.ps1'
$generateSbom = Join-Path $PSScriptRoot 'generate-sbom.ps1'
$validateRelease = Join-Path $PSScriptRoot 'validate-release.ps1'
$frontend = Join-Path $repoRoot 'WEB-itinvent\frontend'

if (-not (Test-Path -LiteralPath $dotnet -PathType Leaf)) {
    $dotnet = (Get-Command dotnet -ErrorAction Stop).Source
}

function Invoke-Checked([scriptblock]$Command, [string]$Description) {
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE"
    }
}

if (-not $NoRestore) {
    Invoke-Checked { & $dotnet restore $solution --configfile (Join-Path $repoRoot 'desktop\NuGet.Config') } 'Desktop restore'
}

Invoke-Checked { & $dotnet test $testProject -c Release --no-restore } 'Desktop tests'
Invoke-Checked { & $dotnet build $solution -c Release --no-restore } 'Desktop build'
& $testDependencies
& $validatePolicyTemplates

if (-not $SkipFrontend) {
    Push-Location $frontend
    try {
        $tests = @(
            'src/pages/Login.test.jsx',
            'src/pages/About.test.jsx',
            'src/pages/account/AccountWorkspace.test.jsx',
            'src/contexts/AuthContext.test.jsx',
            'src/lib/desktopInstallerFeed.test.js',
            'src/components/desktop/DesktopInstallerDownload.test.jsx',
            'src/lib/desktopBridge.test.js',
            'src/lib/chatSocket.test.js',
            'src/lib/chatNotifications.test.js',
            'src/lib/windowsNotifications.test.js',
            'src/lib/systemNotificationEnvelope.test.js',
            'src/lib/systemNotificationRouter.test.js',
            'src/lib/notificationPreferences.test.js',
            'src/contexts/NotificationContext.test.jsx',
            'src/api/desktopPresence.test.js',
            'src/components/layout/DesktopPresenceBootstrap.test.jsx',
            'src/pages/SettingsNotifications.test.jsx',
            'src/components/layout/DesktopNavigationBootstrap.test.jsx',
            'src/components/fileActions/FileActionsContextMenu.test.jsx',
            'src/components/documentPreview/DocumentPreviewDialog.test.jsx'
        )
        Invoke-Checked { & npx vitest run @tests } 'Desktop frontend regression'
        Invoke-Checked { & npm run build } 'Frontend production build'
    }
    finally {
        Pop-Location
    }
}

if (-not $SkipInstaller) {
    if ($NoRestore) {
        Invoke-Checked { & $buildInstaller -NoRestore } 'Desktop installer build'
    }
    else {
        Invoke-Checked { & $buildInstaller } 'Desktop installer build'
    }
    & $generateSbom
    & $validateRelease
}

[pscustomobject]@{
    DesktopTests = 'Passed'
    DesktopBuild = 'Passed'
    Frontend = if ($SkipFrontend) { 'Skipped' } else { 'Passed' }
    Installer = if ($SkipInstaller) { 'Skipped' } else { 'Passed' }
    DependencyAudit = 'Passed'
    PolicyTemplates = 'Passed'
    SBOM = if ($SkipInstaller) { 'Skipped' } else { 'Passed' }
}
