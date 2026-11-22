$ErrorActionPreference = 'Continue'
$out = 'C:\Project\HUB-IT-main\rest_index.csv'
'name;size;rel' | Out-File $out -Encoding UTF8
foreach ($r in '\\?\UNC\10.103.0.170\Object', '\\?\UNC\10.103.0.170\Projects') {
  $files = @(Get-ChildItem -LiteralPath $r -Recurse -File -Force -ErrorAction SilentlyContinue)
  foreach ($f in $files) {
    '{0};{1};{2}' -f ($f.Name -replace ';',','), $f.Length, ($f.FullName -replace ';',',') | Out-File $out -Append -Encoding UTF8
  }
  "$r -> $($files.Count)"
}
'DONE'
