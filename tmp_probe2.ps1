$ErrorActionPreference = 'Continue'

'=== dirs named *абдулова* / *Абдулова* on Common (2 levels) ==='
Get-ChildItem -LiteralPath '\\10.103.0.170\Common' -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
  $d = $_
  if ($d.Name -match 'Абдулова') { $d.FullName }
  Get-ChildItem -LiteralPath $d.FullName -Directory -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'Абдулова' } | ForEach-Object { $_.FullName }
}

'=== deep full-file check: 10MB zeroed rar ==='
$p = '\\10.103.0.170\Common\IT\Абдулова Л.М\Выполнение РГХ-ЗСГП-Г.rar'
$fs = [IO.File]::OpenRead($p)
$buf = New-Object byte[] 1MB
$totalNZ = 0; $totalRead = 0
while ($true) {
  $r = $fs.Read($buf, 0, $buf.Length)
  if ($r -le 0) { break }
  $totalRead += $r
  for ($j=0; $j -lt $r; $j++) { if ($buf[$j] -ne 0) { $totalNZ++ } }
}
$fs.Close()
"rar full scan: $totalRead bytes read, nonzero=$totalNZ"

'=== one more big pdf deep check ==='
$p2 = '\\10.103.0.170\Common\IT\Абдулова Л.М\требование аудита.pdf'
$fs = [IO.File]::OpenRead($p2)
$nz2=0; $rd2=0
while ($true) { $r = $fs.Read($buf,0,$buf.Length); if ($r -le 0) {break}; $rd2+=$r; for($j=0;$j -lt $r;$j++){if($buf[$j] -ne 0){$nz2++}} }
$fs.Close()
"pdf full scan: $rd2 bytes read, nonzero=$nz2"
