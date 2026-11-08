param(
    [string]$LogDir = (Join-Path $env:USERPROFILE '.pm2\logs'),
    [int]$MaxSizeMB = 200,
    [int]$KeepDays = 14,
    [switch]$DryRun
)

# Ротация логов PM2 методом copytruncate: PM2 держит файл открытым, поэтому переименовать его нельзя.
# Большой лог сжимается в archive\<имя>.<время>.gz, затем исходный файл обнуляется.
# Строки, записанные за время сжатия, теряются (секунды-минуты шума); ради этого процессы не перезапускаются.
# Запуск без ключей — реальная ротация; -DryRun только показывает, что будет сделано.

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $LogDir)) { throw "Log dir not found: $LogDir" }
$archiveDir = Join-Path $LogDir 'archive'
$limit = [int64]$MaxSizeMB * 1MB
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

$candidates = Get-ChildItem -LiteralPath $LogDir -Filter '*.log' -File | Where-Object { $_.Length -gt $limit }
foreach ($file in $candidates) {
    $archive = Join-Path $archiveDir ("{0}.{1}.gz" -f $file.BaseName, $stamp)
    if ($DryRun) {
        Write-Output ("[dry-run] {0}: {1:N0} MB -> {2}" -f $file.Name, ($file.Length / 1MB), $archive)
        continue
    }
    New-Item -ItemType Directory -Force -Path $archiveDir | Out-Null
    $length = $file.Length
    $source = [System.IO.File]::Open($file.FullName, 'Open', 'Read', 'ReadWrite')
    try {
        $target = [System.IO.File]::Create($archive)
        try {
            $gzip = New-Object System.IO.Compression.GZipStream($target, [System.IO.Compression.CompressionLevel]::Fastest)
            try {
                $buffer = New-Object byte[] (1MB)
                $left = $length
                while ($left -gt 0) {
                    $chunk = [int][Math]::Min([int64]$buffer.Length, [int64]$left)
                    $read = $source.Read($buffer, 0, $chunk)
                    if ($read -le 0) { break }
                    $gzip.Write($buffer, 0, $read)
                    $left -= $read
                }
            } finally { $gzip.Dispose() }
        } finally { $target.Dispose() }
    } finally { $source.Dispose() }

    # Обнуляем только после успешной записи архива.
    $writer = [System.IO.File]::Open($file.FullName, 'Open', 'Write', 'ReadWrite')
    try { $writer.SetLength(0) } finally { $writer.Dispose() }
    Write-Output ("rotated {0}: {1:N0} MB -> {2}" -f $file.Name, ($length / 1MB), $archive)
}

if (Test-Path -LiteralPath $archiveDir) {
    $cutoff = (Get-Date).AddDays(-$KeepDays)
    Get-ChildItem -LiteralPath $archiveDir -Filter '*.gz' -File | Where-Object { $_.LastWriteTime -lt $cutoff } | ForEach-Object {
        if ($DryRun) { Write-Output "[dry-run] delete old archive $($_.Name)" } else { Remove-Item -LiteralPath $_.FullName -Force; Write-Output "deleted old archive $($_.Name)" }
    }
}
