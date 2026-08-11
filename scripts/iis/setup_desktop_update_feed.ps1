[CmdletBinding()]
param(
    [string]$SiteName = 'hubit',
    [string]$VirtualPath = 'desktop-updates',
    [string]$PhysicalPath = 'C:\inetpub\wwwroot\hub-desktop-updates'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module WebAdministration
New-Item -ItemType Directory -Path $PhysicalPath -Force | Out-Null

$existing = Get-WebVirtualDirectory -Site $SiteName -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq "/$VirtualPath" } |
    Select-Object -First 1
if ($null -eq $existing) {
    New-WebVirtualDirectory -Site $SiteName -Name $VirtualPath -PhysicalPath $PhysicalPath | Out-Null
} else {
    Set-ItemProperty "IIS:\Sites\$SiteName\$VirtualPath" -Name physicalPath -Value $PhysicalPath
}

$webConfig = @'
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <staticContent>
      <remove fileExtension=".json" />
      <mimeMap fileExtension=".json" mimeType="application/json" />
      <remove fileExtension=".exe" />
      <mimeMap fileExtension=".exe" mimeType="application/octet-stream" />
      <clientCache cacheControlMode="UseMaxAge" cacheControlMaxAge="365.00:00:00" />
    </staticContent>
    <httpProtocol>
      <customHeaders>
        <remove name="X-Content-Type-Options" />
        <add name="X-Content-Type-Options" value="nosniff" />
      </customHeaders>
    </httpProtocol>
  </system.webServer>
  <location path="stable/latest.json">
    <system.webServer>
      <staticContent>
        <clientCache cacheControlMode="DisableCache" />
      </staticContent>
    </system.webServer>
  </location>
</configuration>
'@
[IO.File]::WriteAllText(
    (Join-Path $PhysicalPath 'web.config'),
    $webConfig,
    [Text.UTF8Encoding]::new($false))

& icacls.exe $PhysicalPath /grant 'IIS_IUSRS:(OI)(CI)(RX)' | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Failed to grant IIS read access; exit code $LASTEXITCODE"
}

[pscustomobject]@{
    Site = $SiteName
    UrlPath = "/$VirtualPath/"
    PhysicalPath = $PhysicalPath
}
