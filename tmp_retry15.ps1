$ErrorActionPreference = 'Continue'
$lpRoot = '\\?\UNC\10.103.0.170\Common\IT\Абдулова Л.М'
$smet = '\\?\UNC\10.103.0.170\Common\Сметный отдел'
$parent = $lpRoot + '\!!СЛ по ТО\Шарапово\258-8УТС Секретный'
$realDir = (Get-ChildItem -LiteralPath $parent -Directory -Force | Where-Object { $_.Name -like '512-ТО Отопление*Макеева' })[0].FullName
"real dir: $realDir"

$log = Import-Csv 'C:\Project\HUB-IT-main\restore_log3.csv' -Delimiter ';' -Header t,s,d,res | Where-Object { $_.res -like 'WRITE-FAIL*' }
"to retry: $($log.Count)"

function Test-Zero($p) {
  try {
    $fs=[IO.File]::OpenRead($p); $len=$fs.Length; $buf=New-Object byte[] 4096
    $nz=0
    foreach($pos in @(0,[long]($len*0.5),[long]([Math]::Max(0,$len-4096)))){
      if($pos -ge $len){continue}; $fs.Position=$pos; $r=$fs.Read($buf,0,4096)
      for($j=0;$j -lt $r;$j++){if($buf[$j] -ne 0){$nz++}}
    }
    $fs.Close()
    if ($nz -gt 0) { return 'HASDATA' } else { return 'ZERO' }
  } catch { return 'FAIL' }
}

$restored=0; $failed=0
foreach ($row in $log) {
  $fname = ($row.t -split '\\')[-1]
  $tp = $realDir + '\' + $fname
  # Эксель subdir case: donor list may point to subdir files; reconstruct properly
  if ($row.t -match '\\Эксель\\') {
    $subdir = (Get-ChildItem -LiteralPath $realDir -Directory -Force | Where-Object { $_.Name -match 'сель' } | Select-Object -First 1).FullName
    if ($subdir) { $tp = $subdir + '\' + $fname }
  }
  $dp = $smet + $row.d
  $tz = Test-Zero $tp
  if ($tz -eq 'FAIL') { "{0} -> target still unresolvable" -f $fname; $failed++; continue }
  if ($tz -ne 'ZERO') { "{0} -> SKIP not zero" -f $fname; continue }
  try {
    $bytes = [IO.File]::ReadAllBytes($dp)
    $fi = Get-Item -LiteralPath $tp -Force
    $wt = $fi.LastWriteTime; $ct = $fi.CreationTime
    [IO.File]::WriteAllBytes($tp, $bytes)
    (Get-Item -LiteralPath $tp -Force).LastWriteTime = $wt
    $restored++
    "RESTORED $fname"
  } catch { "FAIL $fname : $($_.Exception.Message)"; $failed++ }
}
"retry done: restored=$restored failed=$failed"
