$ErrorActionPreference = 'Continue'
$roots = @()
Get-ChildItem -LiteralPath '\\10.103.0.170\Common' -Directory -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'Обмен' } | ForEach-Object { $roots += '\\?\UNC\' + $_.FullName.Substring(2) }
$roots += '\\?\UNC\10.103.0.170\Public'
"indexing $($roots.Count) roots"
$out = 'C:\Project\HUB-IT-main\obmen_index.csv'
'name;size;rel' | Out-File $out -Encoding UTF8
$tot = 0
foreach ($r in $roots) {
  $files = @(Get-ChildItem -LiteralPath $r -Recurse -File -Force -ErrorAction SilentlyContinue)
  $tot += $files.Count
  foreach ($f in $files) {
    '{0};{1};{2}' -f ($f.Name -replace ';',','), $f.Length, ($f.FullName -replace ';',',') | Out-File $out -Append -Encoding UTF8
  }
  "$r -> $($files.Count)"
}
"TOTAL $tot"
