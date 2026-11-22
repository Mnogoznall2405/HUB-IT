$ErrorActionPreference = 'Continue'
# resolve target root without Cyrillic literal (PS5.1 + UTF-8 no-BOM issue)
$itDir = Get-ChildItem '\\10.103.0.170\Common\IT' -Directory | Where-Object { $_.Name -match '^\u0410\u0431\u0434\u0443' } | Select-Object -First 1
$lpRoot = '\\?\UNC\10.103.0.170\Common\IT\' + $itDir.Name
"root: $($itDir.FullName)"

# failed targets: name+size from log6 WRITE-FAIL rows -> real relpath via scan_all.csv
$fails = Select-String -Path 'C:\Project\HUB-IT-main\restore_log6.csv' -Pattern 'WRITE-FAIL' | ForEach-Object {
  $p = $_.Line -split ';'
  @{ size=[long]$p[1]; name=($p[0] -split '\\')[-1]; donor=($p[2..($p.Count-2)] -join ';') }
}
"targets: $($fails.Count)"

$d = Import-Csv 'C:\Project\HUB-IT-main\scan_all.csv' -Delimiter ';'
$byKey=@{}
foreach($r in $d){ if($r.status -eq 'ALLZERO'){ $byKey[(($r.relpath -split '\\')[-1] + '|' + $r.size)] = $r.relpath } }

$restored=0;$miss=0
foreach ($f in $fails) {
  $key = $f.name + '|' + $f.size
  $rel = $byKey[$key]
  if (-not $rel) { "NOREL: $key"; $miss++; continue }
  $tp = $lpRoot + $rel
  try {
    $head = New-Object byte[] 16
    $fs=[IO.File]::OpenRead($tp); $r=$fs.Read($head,0,16); $fs.Close()
    $nz = ($head[0..($r-1)] | Where-Object {$_ -ne 0}).Count
    if ($nz -gt 0) { "SKIP notzero: $rel"; continue }
    $fi = Get-Item -LiteralPath $tp -Force
    $wt=$fi.LastWriteTime; $ct=$fi.CreationTime
    [IO.File]::WriteAllBytes($tp, [IO.File]::ReadAllBytes($f.donor))
    $fi2 = Get-Item -LiteralPath $tp -Force
    $fi2.LastWriteTime=$wt; $fi2.CreationTime=$ct
    $restored++
    "RESTORED: $rel <- $($f.donor)"
  } catch { "FAIL: $rel :: $($_.Exception.Message)" }
}
"DONE restored=$restored miss=$miss"
