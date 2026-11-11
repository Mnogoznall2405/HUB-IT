# Shared chat runtime-mode helpers for PM2 scripts.
# Production chat can run either as a single `itinvent-chat` process or as the
# dual PostgreSQL-realtime pair `itinvent-chat-a`/`itinvent-chat-b`. Mode is
# auto-detected from the repo .env (CHAT_REALTIME_TRANSPORT=postgres plus the
# scale ecosystem file) and can be overridden explicitly.

function Get-ChatRuntimeMode {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [ValidateSet('auto', 'single', 'dual')][string]$Override = 'auto'
    )

    if ($Override -ne 'auto') {
        return $Override
    }

    $scaleConfig = Join-Path $ProjectRoot 'scripts\pm2\ecosystem.chat.scale.config.js'
    $envPath = Join-Path $ProjectRoot '.env'
    $transport = ''
    if (Test-Path -LiteralPath $envPath) {
        foreach ($line in Get-Content -LiteralPath $envPath) {
            if ($line -match '^\s*CHAT_REALTIME_TRANSPORT\s*=\s*(.*)$') {
                $transport = $Matches[1].Trim().Trim('"', "'")
                break
            }
        }
    }

    if ($transport -eq 'postgres' -and (Test-Path -LiteralPath $scaleConfig)) {
        return 'dual'
    }
    return 'single'
}

function Get-ChatProcessNames {
    param([Parameter(Mandatory = $true)][string]$Mode)

    if ($Mode -eq 'dual') {
        return @('itinvent-chat-a', 'itinvent-chat-b')
    }
    return @('itinvent-chat')
}
