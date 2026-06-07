param(
    [switch]$Json
)

$ErrorActionPreference = 'Stop'
$projectRoot = 'C:\Project\Image_scan'
$envPath = Join-Path $projectRoot '.env'

function Get-EmptyDotEnvKeys {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        return @()
    }

    $empty = New-Object System.Collections.Generic.List[string]
    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith('#')) { return }
        $idx = $line.IndexOf('=')
        if ($idx -lt 1) { return }
        $key = $line.Substring(0, $idx).Trim()
        $value = $line.Substring($idx + 1).Trim()
        if ($value -eq '') {
            [void]$empty.Add($key)
        }
    }
    return $empty.ToArray()
}

$emptyDotEnv = Get-EmptyDotEnvKeys -Path $envPath
$pm2EmptyByProcess = @{}

try {
    $nodeScript = Join-Path $PSScriptRoot 'list-empty-env-pm2.js'
    if (-not (Test-Path $nodeScript)) {
        throw "Node helper not found: $nodeScript"
    }

    $nodeCmd = (Get-Command node -ErrorAction Stop).Source
    $pm2Json = & $nodeCmd $nodeScript 2>$null
    if ($LASTEXITCODE -eq 0 -and $pm2Json) {
        $parsed = $pm2Json | ConvertFrom-Json
        foreach ($prop in $parsed.PSObject.Properties) {
            $pm2EmptyByProcess[[string]$prop.Name] = @([string[]]$prop.Value)
        }
    }
}
catch {
    Write-Warning "PM2 scan skipped: $($_.Exception.Message)"
}

$result = [ordered]@{
    dotenv_path = $envPath
    dotenv_empty_keys = $emptyDotEnv
    pm2_empty_by_process = $pm2EmptyByProcess
}

if ($Json) {
    $result | ConvertTo-Json -Depth 5
    exit 0
}

Write-Host ".env empty keys ($($emptyDotEnv.Count)):" -ForegroundColor Cyan
if ($emptyDotEnv.Count -eq 0) {
    Write-Host '  (none)'
}
else {
    $emptyDotEnv | Sort-Object | ForEach-Object { Write-Host "  $_" }
}

Write-Host ''
Write-Host 'PM2 processes with empty app env vars:' -ForegroundColor Cyan
if ($pm2EmptyByProcess.Count -eq 0) {
    Write-Host '  (none)'
}
else {
    foreach ($entry in ($pm2EmptyByProcess.GetEnumerator() | Sort-Object Name)) {
        Write-Host ("  {0}: {1}" -f $entry.Key, ($entry.Value -join ', '))
    }
}
