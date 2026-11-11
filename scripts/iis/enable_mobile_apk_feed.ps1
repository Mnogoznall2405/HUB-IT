[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$PhysicalPath = 'C:\inetpub\wwwroot\hub-desktop-updates',
    [string]$BackupRoot = 'C:\ProgramData\HUB-IT\Backups\IIS'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $PhysicalPath -PathType Container)) {
    throw "Desktop update physical path does not exist: $PhysicalPath"
}
$resolvedRoot = (Resolve-Path -LiteralPath $PhysicalPath).Path
$webConfigPath = Join-Path $resolvedRoot 'web.config'
if (-not (Test-Path -LiteralPath $webConfigPath -PathType Leaf)) {
    throw "Update feed web.config is missing: $webConfigPath"
}

$document = [xml](Get-Content -Raw -LiteralPath $webConfigPath -Encoding UTF8)
$configuration = $document.configuration
if ($null -eq $configuration -or $null -eq $configuration.'system.webServer') {
    throw 'Unexpected update feed web.config structure.'
}
$staticContent = $configuration.'system.webServer'.staticContent
if ($null -eq $staticContent) {
    $staticContent = $document.CreateElement('staticContent')
    [void]$configuration.'system.webServer'.AppendChild($staticContent)
}

@($staticContent.ChildNodes) |
    Where-Object {
        $_.NodeType -eq [Xml.XmlNodeType]::Element -and
        $_.Name -in @('remove', 'mimeMap') -and
        $_.GetAttribute('fileExtension') -eq '.apk'
    } |
    ForEach-Object { [void]$staticContent.RemoveChild($_) }

$removeApk = $document.CreateElement('remove')
$removeApk.SetAttribute('fileExtension', '.apk')
[void]$staticContent.AppendChild($removeApk)
$mimeMapApk = $document.CreateElement('mimeMap')
$mimeMapApk.SetAttribute('fileExtension', '.apk')
$mimeMapApk.SetAttribute('mimeType', 'application/vnd.android.package-archive')
[void]$staticContent.AppendChild($mimeMapApk)

@($configuration.location) |
    Where-Object { $_.GetAttribute('path') -eq 'mobile/preview/latest.json' } |
    ForEach-Object { [void]$configuration.RemoveChild($_) }

$location = $document.CreateElement('location')
$location.SetAttribute('path', 'mobile/preview/latest.json')
$locationSystemWebServer = $document.CreateElement('system.webServer')
$locationStaticContent = $document.CreateElement('staticContent')
$clientCache = $document.CreateElement('clientCache')
$clientCache.SetAttribute('cacheControlMode', 'DisableCache')
[void]$locationStaticContent.AppendChild($clientCache)
[void]$locationSystemWebServer.AppendChild($locationStaticContent)
[void]$location.AppendChild($locationSystemWebServer)
[void]$configuration.AppendChild($location)

$settings = [Xml.XmlWriterSettings]::new()
$settings.Encoding = [Text.UTF8Encoding]::new($false)
$settings.Indent = $true
$settings.NewLineChars = "`r`n"
$temporaryPath = Join-Path $resolvedRoot ('web.config.mobile-apk-' + [Guid]::NewGuid().ToString('N') + '.tmp')

if (-not $PSCmdlet.ShouldProcess($webConfigPath, 'Enable Android APK MIME type and no-cache preview manifest')) {
    return [pscustomobject]@{
        PhysicalPath = $resolvedRoot
        WebConfig = $webConfigPath
        Backup = $null
        Changed = $false
    }
}

New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
$timestamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMdd-HHmmssfff')
$backupPath = Join-Path $BackupRoot "hub-desktop-updates-web.config-$timestamp.bak"
Copy-Item -LiteralPath $webConfigPath -Destination $backupPath

try {
    $writer = [Xml.XmlWriter]::Create($temporaryPath, $settings)
    try {
        $document.Save($writer)
    }
    finally {
        $writer.Dispose()
    }
    [xml]$null = Get-Content -Raw -LiteralPath $temporaryPath -Encoding UTF8
    Move-Item -LiteralPath $temporaryPath -Destination $webConfigPath -Force
}
finally {
    if (Test-Path -LiteralPath $temporaryPath) {
        Remove-Item -LiteralPath $temporaryPath -Force
    }
}

[pscustomobject]@{
    PhysicalPath = $resolvedRoot
    WebConfig = $webConfigPath
    Backup = $backupPath
    Changed = $true
}
