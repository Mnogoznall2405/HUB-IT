$ErrorActionPreference = 'Continue'
$lpRoot = '\\?\UNC\10.103.0.170\Common\IT\Абдулова Л.М'
$smet = '\\?\UNC\10.103.0.170\Common\Сметный отдел'
$d = Import-Csv 'C:\Project\HUB-IT-main\scan_all.csv' -Delimiter ';'
$sm = Import-Csv 'C:\Project\HUB-IT-main\smet_index.csv' -Delimiter ';' -Header name,size,rel

$si = @{}
foreach ($r in $sm) { $k = $r.name + '|' + $r.size; if (-not $si[$k]) { $si[$k] = $r.rel } }
$done = @{}
if (Test-Path 'C:\Project\HUB-IT-main\restore_log1.csv') {
  Import-Csv 'C:\Project\HUB-IT-main\restore_log1.csv' -Delimiter ';' -Header t,s,d,res | Where-Object {$_.res -eq 'RESTORED'} | ForEach-Object { $done[$_.t]=$true }
}

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

$log = 'C:\Project\HUB-IT-main\restore_log3.csv'
'target;size;donor;result' | Out-File $log -Encoding UTF8
$restored=0; $skipped=0; $failed=0; $nodonor=0; $cand=0
foreach ($r in $d) {
  if ($r.status -ne 'ALLZERO') { continue }
  if ($done[$r.relpath]) { continue }  # already restored in phase1
  $name = ($r.relpath -split '\\')[-1]
  $k = $name + '|' + $r.size
  $tp = $lpRoot + $r.relpath
  if (-not $si[$k]) { $nodonor++; continue }
  $dp = $smet + $si[$k]
  if ((Test-Zero $dp) -ne 'HASDATA') { '{0};{1};{2};DONOR-BAD' -f ($r.relpath -replace ';',','), $r.size, ($si[$k] -replace ';',',') | Out-File $log -Append -Encoding UTF8; continue }
  $tz = Test-Zero $tp
  if ($tz -ne 'ZERO' -and $tz -ne 'FAIL') { $skipped++; '{0};{1};{2};SKIP-TARGET-NOTZERO' -f ($r.relpath -replace ';',','), $r.size, ($si[$k] -replace ';',',') | Out-File $log -Append -Encoding UTF8; continue }
  try {
    $fi = Get-Item -LiteralPath $tp -Force
    $wt = $fi.LastWriteTime; $ct = $fi.CreationTime
    $bytes = [IO.File]::ReadAllBytes($dp)
    [IO.File]::WriteAllBytes($tp, $bytes)
    $fi2 = Get-Item -LiteralPath $tp -Force
    $fi2.LastWriteTime = $wt; $fi2.CreationTime = $ct
    $restored++
    '{0};{1};{2};RESTORED' -f ($r.relpath -replace ';',','), $r.size, ($si[$k] -replace ';',',') | Out-File $log -Append -Encoding UTF8
  } catch {
    $failed++
    '{0};{1};{2};WRITE-FAIL:{3}' -f ($r.relpath -replace ';',','), $r.size, ($si[$k] -replace ';',','), ($_.Exception.Message -replace ';',':') | Out-File $log -Append -Encoding UTF8
  }
}
"DONE restored=$restored skipped=$skipped failed=$failed nodonor=$nodonor"
