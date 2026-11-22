$root = '\\10.103.0.170\Common\IT\Абдулова Л.М'
$top = Get-ChildItem -LiteralPath $root -Force
Write-Output ('TOP ITEMS: ' + $top.Count)
$files = Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction Continue
Write-Output ('FILES: ' + $files.Count)
$files | Group-Object Extension | Sort-Object Count -Descending | Select-Object Count, Name | Format-Table -AutoSize | Out-String -Width 100
