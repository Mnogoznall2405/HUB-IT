[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateRange(20, 1000)]
    [int]$MaxConnections = 300,

    [string]$ConfigPath = 'C:\Program Files\PostgreSQL\16\data\postgresql.conf'
)

$resolvedConfig = [System.IO.Path]::GetFullPath($ConfigPath)
$allowedRoot = [System.IO.Path]::GetFullPath('C:\Program Files\PostgreSQL\')
if (-not $resolvedConfig.StartsWith($allowedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to edit PostgreSQL config outside $allowedRoot"
}
if (-not (Test-Path -LiteralPath $resolvedConfig -PathType Leaf)) {
    throw "PostgreSQL config not found: $resolvedConfig"
}

$content = [System.IO.File]::ReadAllText($resolvedConfig)
$linePattern = '^[ \t]*max_connections[ \t]*=[ \t]*\d+'
$matchedLines = @(
    [System.IO.File]::ReadAllLines($resolvedConfig) |
        Where-Object { $_ -match $linePattern }
)
if ($matchedLines.Count -ne 1) {
    throw "Expected exactly one active max_connections setting, found $($matchedLines.Count)"
}

$replacement = "max_connections = $MaxConnections`t`t`t# (change requires restart)"
$updated = $content.Replace([string]$matchedLines[0], $replacement)
if ($updated -eq $content) {
    Write-Output "PostgreSQL max_connections is already $MaxConnections"
    exit 0
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = "$resolvedConfig.hubit-$stamp.bak"
if ($PSCmdlet.ShouldProcess($resolvedConfig, "Set max_connections=$MaxConnections")) {
    Copy-Item -LiteralPath $resolvedConfig -Destination $backupPath -ErrorAction Stop
    [System.IO.File]::WriteAllText(
        $resolvedConfig,
        $updated,
        [System.Text.UTF8Encoding]::new($false)
    )
    $verified = [System.IO.File]::ReadAllText($resolvedConfig)
    if ($verified -notmatch "(?m)^max_connections[ \t]*=[ \t]*$MaxConnections(?:[ \t]|$)") {
        Copy-Item -LiteralPath $backupPath -Destination $resolvedConfig -Force
        throw "Verification failed; restored $backupPath"
    }
    Write-Output "Updated max_connections=$MaxConnections"
    Write-Output "Backup: $backupPath"
}
