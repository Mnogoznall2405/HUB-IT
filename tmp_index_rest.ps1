$ErrorActionPreference = 'Continue'
$skip = '^(Сметный отдел|Обмен|IT$|IT\\)'
$dirs = Get-ChildItem -LiteralPath '\\10.103.0.170\Common' -Directory -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notmatch $skip }
"dirs to index: $($dirs.Count)"
$out = 'C:\Project\HUB-IT-main\common_index.csv'
'name;size;rel' | Out-File $out -Encoding UTF8
$tot = 0
foreach ($d in $dirs) {
  $p = '\\?\UNC\' + $d.FullName.Substring(2)
  $files = @(Get-ChildItem -LiteralPath $p -Recurse -File -Force -ErrorAction SilentlyContinue)
  $tot += $files.Count
  foreach ($f in $files) {
    '{0};{1};{2}' -f ($f.Name -replace ';',','), $f.Length, ($f.FullName -replace ';',',') | Out-File $out -Append -Encoding UTF8
  }
  "$($d.Name) -> $($files.Count)"
}
"TOTAL $tot"
