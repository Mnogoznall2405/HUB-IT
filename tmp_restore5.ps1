$ErrorActionPreference = 'Continue'
$lpRoot = '\\?\UNC\10.103.0.170\Common\IT\Абдулова Л.М'
$d = Import-Csv 'C:\Project\HUB-IT-main\scan_all.csv' -Delimiter ';'
$done=@{}
foreach($lg in 'restore_log1.csv','restore_log3.csv','restore_log4.csv'){
  Import-Csv "C:\Project\HUB-IT-main\$lg" -Delimiter ';' -Header t,s,d,res | Where-Object {$_.res -eq 'RESTORED'} | ForEach-Object { $done[$_.t]=$true }
}
$rem = $d | Where-Object { $_.status -eq 'ALLZERO' -and -not $done[$_.relpath] }

function Parse-Index($path, $prefix) {
  $map = @{}
  foreach ($line in [IO.File]::ReadLines($path)) {
    if ($line -eq 'name;size;rel') { continue }
    $f = $line -split ';'
    $j = -1
    for ($i=1; $i -lt $f.Count; $i++) { if ($f[$i] -match '^\\') { $j=$i; break } }
    if ($j -lt 2) { continue }
    $sizeStr = $f[$j-1]
    if ($sizeStr -notmatch '^\d+$') { continue }
    $name = ($f[0..($j-2)] -join ';')
    $rel  = ($f[$j..($f.Count-1)] -join ';')
    if (-not $map[$name]) { $map[$name] = @() }
    $map[$name] += ,@{size=[long]$sizeStr; rel=($prefix + $rel)}
  }
  return $map
}
$nm = @{}
foreach ($kv in (Parse-Index 'C:\Project\HUB-IT-main\smet_index.csv' '\\?\UNC\10.103.0.170\Common\Сметный отдел').GetEnumerator()) { $nm[$kv.Key] = $kv.Value }
foreach ($kv in (Parse-Index 'C:\Project\HUB-IT-main\obmen_index.csv' '').GetEnumerator()) {
  if ($nm[$kv.Key]) { $nm[$kv.Key] += $kv.Value } else { $nm[$kv.Key] = $kv.Value }
}
"donor names indexed: $($nm.Count)"

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

$log = 'C:\Project\HUB-IT-main\restore_log5.csv'
'target;size;donor;result' | Out-File $log -Encoding UTF8
$restored=0; $skipped=0; $failed=0; $nodonor=0
foreach ($r in $rem) {
  $name = ($r.relpath -split '\\')[-1]
  $tp = $lpRoot + $r.relpath
  if (-not $nm[$name]) { $nodonor++; continue }
  $cands = $nm[$name]
  $sizes = $cands | ForEach-Object {$_.size} | Select-Object -Unique
  $amb = if ($sizes.Count -gt 1) {'VERSION-AMBIG'} else {'VERSION-UNIQ'}
  $best = $cands | Sort-Object {[math]::Abs($_.size - [long]$r.size)} | Select-Object -First 1
  $dp = $best.rel
  if ((Test-Zero $dp) -ne 'HASDATA') { '{0};{1};{2};DONOR-BAD' -f ($r.relpath -replace ';',','), $r.size, ($dp -replace ';',',') | Out-File $log -Append -Encoding UTF8; continue }
  $tz = Test-Zero $tp
  if ($tz -ne 'ZERO' -and $tz -ne 'FAIL') { $skipped++; '{0};{1};{2};SKIP-TARGET-NOTZERO' -f ($r.relpath -replace ';',','), $r.size, ($dp -replace ';',',') | Out-File $log -Append -Encoding UTF8; continue }
  try {
    $fi = Get-Item -LiteralPath $tp -Force
    $wt = $fi.LastWriteTime; $ct = $fi.CreationTime
    $bytes = [IO.File]::ReadAllBytes($dp)
    [IO.File]::WriteAllBytes($tp, $bytes)
    $fi2 = Get-Item -LiteralPath $tp -Force
    $fi2.LastWriteTime = $wt; $fi2.CreationTime = $ct
    $restored++
    '{0};{1};{2};{3}' -f ($r.relpath -replace ';',','), $r.size, ($dp -replace ';',','), $amb | Out-File $log -Append -Encoding UTF8
  } catch {
    $failed++
    '{0};{1};{2};WRITE-FAIL:{3}' -f ($r.relpath -replace ';',','), $r.size, ($dp -replace ';',','), ($_.Exception.Message -replace ';',':') | Out-File $log -Append -Encoding UTF8
  }
}
"DONE restored=$restored skipped=$skipped failed=$failed nodonor=$nodonor"
