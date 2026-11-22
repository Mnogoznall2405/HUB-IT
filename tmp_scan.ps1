$ErrorActionPreference = 'Continue'
$it = '\\10.103.0.170\Common\IT'
$dirs = Get-ChildItem -LiteralPath $it -Directory -Force | Where-Object { $_.Name -match 'Абдулова' }
$dirs | ForEach-Object { Write-Output ('DIR MATCH: ' + $_.FullName) }
$root = $dirs[0].FullName
Write-Output ('ROOT: ' + $root)
$files = @(Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue)
Write-Output ('TOTAL FILES: ' + $files.Count)
$files | Group-Object { $_.Extension.ToLower() } | Sort-Object Count -Descending |
    Select-Object Count, Name | Format-Table -AutoSize | Out-String -Width 120
