param(
    [Parameter(Mandatory = $false)]
    [ValidateSet("on", "off")]
    [string]$State = "on"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$envPath = Join-Path $projectRoot ".env"

if (-not (Test-Path -LiteralPath $envPath)) {
    throw "Env file not found: $envPath"
}

$enabled = if ($State -eq "on") { "1" } else { "0" }
$content = Get-Content -LiteralPath $envPath -Raw

if ($content -match "(?m)^AUTH_2FA_ENFORCED=.*$") {
    $updated = [regex]::Replace($content, "(?m)^AUTH_2FA_ENFORCED=.*$", "AUTH_2FA_ENFORCED=$enabled")
} else {
    $suffix = if ($content.EndsWith("`r`n") -or $content.EndsWith("`n")) { "" } else { "`r`n" }
    $updated = "$content$suffix" + "AUTH_2FA_ENFORCED=$enabled`r`n"
}

Set-Content -LiteralPath $envPath -Value $updated -Encoding UTF8

Write-Output "AUTH_2FA_ENFORCED=$enabled"
Write-Output "Restart backend/IIS to apply the change."
