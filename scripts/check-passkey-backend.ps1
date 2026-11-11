#Requires -Version 5.1
<#
.SYNOPSIS
  Quick passkey/backend diagnostics for HUB-IT (login-mode, assetlinks, local backend).
#>
$ErrorActionPreference = 'Continue'

function Write-Block([string]$Title) {
    Write-Host ""
    Write-Host "==> $Title" -ForegroundColor Cyan
}

Write-Block 'Production login-mode (as seen by IIS from this host)'
try {
    $mode = Invoke-RestMethod -Uri 'https://hubit.zsgp.ru/api/v1/auth/login-mode' -UseBasicParsing
    $mode | ConvertTo-Json -Compress
    if ($mode.network_zone -eq 'internal') {
        Write-Host 'Note: internal from this server is expected (10.x or loopback). Phones on mobile internet should get external.' -ForegroundColor Yellow
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
}

Write-Block 'Backend login-mode with simulated external phone IP (127.0.0.1 + X-Forwarded-For)'
try {
    $headers = @{
        'X-Forwarded-For' = '203.0.113.50'
        'X-Forwarded-Proto' = 'https'
    }
    $sim = Invoke-RestMethod -Uri 'http://127.0.0.1:8001/api/v1/auth/login-mode' -Headers $headers
    $sim | ConvertTo-Json -Compress
    if (-not $sim.biometric_login_enabled) {
        Write-Host 'Expected biometric_login_enabled=true for external IP. Check WEBAUTHN_* in .env and pm2 restart.' -ForegroundColor Red
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
}

Write-Block 'assetlinks.json'
try {
    $asset = Invoke-WebRequest -Uri 'https://hubit.zsgp.ru/.well-known/assetlinks.json' -UseBasicParsing
    Write-Host "HTTP $($asset.StatusCode) $($asset.Headers['Content-Type'])"
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
}

Write-Block 'PM2 WEBAUTHN env (itinvent-backend)'
try {
    pm2 env 0 2>&1 | Select-String 'WEBAUTHN'
} catch {
    Write-Host 'pm2 not available' -ForegroundColor Yellow
}

Write-Host ""
Write-Host 'On phone (mobile data, not corp Wi-Fi): open https://hubit.zsgp.ru/api/v1/auth/login-mode' -ForegroundColor Green
Write-Host 'Expected: {"network_zone":"external","biometric_login_enabled":true}' -ForegroundColor Green
