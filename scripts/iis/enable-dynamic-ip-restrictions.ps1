param(
  [string]$SiteName = "Default Web Site",
  [int]$MaxRequests = 120,
  [int]$RequestWindowSeconds = 10,
  [int]$MaxConcurrentRequests = 30
)

$appcmd = Join-Path $env:WinDir "System32\inetsrv\appcmd.exe"
if (-not (Test-Path $appcmd)) {
  throw "appcmd.exe not found. Install IIS Management Scripts and Tools."
}

Write-Host "Configuring Dynamic IP Restrictions for site '$SiteName'..."

& $appcmd set config "$SiteName" /section:system.webServer/security/dynamicIpSecurity /denyByRequestRate.enabled:"True" /commit:apphost
& $appcmd set config "$SiteName" /section:system.webServer/security/dynamicIpSecurity /denyByRequestRate.maxRequests:"$MaxRequests" /commit:apphost
& $appcmd set config "$SiteName" /section:system.webServer/security/dynamicIpSecurity /denyByRequestRate.requestIntervalInMilliseconds:"$($RequestWindowSeconds * 1000)" /commit:apphost
& $appcmd set config "$SiteName" /section:system.webServer/security/dynamicIpSecurity /denyByConcurrentRequests.enabled:"True" /commit:apphost
& $appcmd set config "$SiteName" /section:system.webServer/security/dynamicIpSecurity /denyByConcurrentRequests.maxConcurrentRequests:"$MaxConcurrentRequests" /commit:apphost
& $appcmd set config "$SiteName" /section:system.webServer/security/dynamicIpSecurity /denyAction:"AbortRequest" /commit:apphost

Write-Host "Done. Recommended auth-specific app limits still live inside FastAPI."
