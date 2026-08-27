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
    <directoryBrowse enabled="false" />
    <security>
      <requestFiltering>
        <verbs allowUnlisted="false">
          <add verb="GET" allowed="true" />
          <add verb="HEAD" allowed="true" />
        </verbs>
      </requestFiltering>
    </security>
    <rewrite>
      <rules>
        <rule name="Reject desktop update query strings" stopProcessing="true">
          <match url=".*" />
          <conditions>
            <add input="{QUERY_STRING}" pattern=".+" />
          </conditions>
          <action type="CustomResponse" statusCode="404" statusReason="Not Found" statusDescription="Not Found" />
        </rule>
      </rules>
      <outboundRules>
        <rule name="Immutable versioned application package" preCondition="VersionedApplicationPackageResponse">
          <match serverVariable="RESPONSE_Cache_Control" pattern=".*" />
          <action type="Rewrite" value="public, max-age=31536000, immutable" />
        </rule>
        <rule name="Do not browser-cache latest application manifest" preCondition="LatestApplicationManifestResponse">
          <match serverVariable="RESPONSE_Cache_Control" pattern=".*" />
          <action type="Rewrite" value="public, max-age=0, s-maxage=60, must-revalidate" />
        </rule>
        <preConditions>
          <preCondition name="VersionedApplicationPackageResponse">
            <add input="{REQUEST_URI}" pattern="^/desktop-updates/(stable/[0-9]+\.[0-9]+\.[0-9]+/HUB-Desktop-Setup-[0-9]+\.[0-9]+\.[0-9]+-win-x64\.exe|mobile/preview/[0-9]+\.[0-9]+\.[0-9]+/HUB-IT-Mobile-Preview-[0-9]+\.[0-9]+\.[0-9]+\.apk)$" />
            <add input="{RESPONSE_STATUS}" pattern="^(200|206)$" />
          </preCondition>
          <preCondition name="LatestApplicationManifestResponse">
            <add input="{REQUEST_URI}" pattern="^/desktop-updates/(stable|mobile/preview)/latest\.json$" />
            <add input="{RESPONSE_STATUS}" pattern="^200$" />
          </preCondition>
        </preConditions>
      </outboundRules>
    </rewrite>
    <staticContent>
      <remove fileExtension=".json" />
      <mimeMap fileExtension=".json" mimeType="application/json" />
      <remove fileExtension=".exe" />
      <mimeMap fileExtension=".exe" mimeType="application/octet-stream" />
      <remove fileExtension=".apk" />
      <mimeMap fileExtension=".apk" mimeType="application/vnd.android.package-archive" />
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
        <clientCache cacheControlMode="UseMaxAge" cacheControlMaxAge="00.00:00:00" />
      </staticContent>
    </system.webServer>
  </location>
  <location path="mobile/preview/latest.json">
    <system.webServer>
      <staticContent>
        <clientCache cacheControlMode="UseMaxAge" cacheControlMaxAge="00.00:00:00" />
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
