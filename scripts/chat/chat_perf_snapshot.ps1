param(
    [string]$ChatHealthUrl = 'http://127.0.0.1:8001/api/v1/chat/health',
    [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'

function Format-RouteMetrics($metrics) {
    if (-not $metrics) {
        return @()
    }
    $rows = @()
    foreach ($property in $metrics.PSObject.Properties) {
        $route = $property.Name
        $value = $property.Value
        $rows += [pscustomobject]@{
            route = $route
            count = [int]($value.count)
            avg_ms = [double]($value.avg_ms)
            p95_ms = [double]($value.p95_ms)
            cache_hit_rate_pct = [double]($value.cache_hit_rate_pct)
            cache_hits = [int]($value.cache_hits)
            cache_misses = [int]($value.cache_misses)
        }
    }
    return $rows | Sort-Object p95_ms -Descending
}

function Evaluate-GoNoGo($health) {
    $notes = @()
    $metrics = $health.route_metrics
    $readCache = $health.read_cache_metrics

    $watchRoutes = @('thread_bootstrap', 'conversations', 'messages')
    foreach ($routeName in $watchRoutes) {
        $route = $metrics.$routeName
        if (-not $route) { continue }
        $hitRate = [double]($route.cache_hit_rate_pct)
        $p95 = [double]($route.p95_ms)
        if ($hitRate -lt 20 -and [int]($route.cache_hits + $route.cache_misses) -ge 20) {
            $notes += "GO Redis cache tuning: route=$routeName cache_hit_rate_pct=$hitRate p95_ms=$p95"
        }
        if ($p95 -gt 800) {
            $notes += "INVESTIGATE: route=$routeName p95_ms=$p95 (pool/SQL/cache)"
        }
    }

    if ($readCache -and $readCache.available -eq $true) {
        $notes += "Redis read cache: available hits=$($readCache.hits) misses=$($readCache.misses) errors=$($readCache.errors)"
    } elseif ($readCache -and $readCache.configured -eq $true) {
        $notes += "WARN: Redis configured but read cache unavailable"
    }

    if ($notes.Count -eq 0) {
        $notes += 'No go/no-go triggers in current snapshot (continue observation).'
    }
    return $notes
}

$response = Invoke-RestMethod -Uri $ChatHealthUrl -Method Get -TimeoutSec 15
$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$routeRows = Format-RouteMetrics $response.route_metrics
$goNoGo = Evaluate-GoNoGo $response

Write-Host "=== Chat perf snapshot $timestamp ==="
Write-Host "URL: $ChatHealthUrl"
Write-Host "realtime_mode: $($response.realtime_mode)"
Write-Host "read_cache: available=$($response.read_cache_metrics.available) hits=$($response.read_cache_metrics.hits) misses=$($response.read_cache_metrics.misses)"
Write-Host ''
Write-Host '--- route_metrics (top p95) ---'
$routeRows | Format-Table -AutoSize
Write-Host ''
Write-Host '--- go/no-go ---'
foreach ($line in $goNoGo) {
    Write-Host $line
}

$snapshot = [pscustomobject]@{
    timestamp = $timestamp
    url = $ChatHealthUrl
    health = $response
    go_no_go = $goNoGo
}

if ($OutputPath) {
    $snapshot | ConvertTo-Json -Depth 12 | Set-Content -Path $OutputPath -Encoding UTF8
    Write-Host ''
    Write-Host "Saved: $OutputPath"
}
