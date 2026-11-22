$ErrorActionPreference = 'Continue'
$lpRoot = '\\?\UNC\10.103.0.170\Common\IT\Абдулова Л.М'
$files = @(Get-ChildItem -LiteralPath $lpRoot -Recurse -File -Force -ErrorAction SilentlyContinue)
$realMap = @{}
foreach ($f in $files) { $realMap[($f.FullName.Substring($lpRoot.Length) -replace ';',',')] = $f.FullName }
"real paths mapped: $($realMap.Count)"

$wf = @()
foreach($lg in 'restore_log3.csv','restore_log5.csv'){
  Import-Csv "C:\Project\HUB-IT-main\$lg" -Delimiter ';' -Header t,s,d,res | Where-Object {$_.res -like 'WRITE-FAIL*'} | ForEach-Object { $wf += $_ }
}
"write-fails to retry: $($wf.Count)"

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

$ok=0; $bad=0
foreach ($row in $wf) {
  $tp = $realMap[$row.t]
  if (-not $tp) { "NOREAL: $($row.t)"; $bad++; continue }
  # donor: logged path may be ','-mangled; verify existence, else search by filename
  $dp = $row.d
  if (-not (Test-Path -LiteralPath $dp)) {
    $nm = ($row.d -split '\\')[-1]
    $cand = Get-ChildItem -LiteralPath '\\?\UNC\10.103.0.170\Common' -Recurse -File -Filter $nm -ErrorAction SilentlyContinue | Select-Object -First 1
    $dp = if ($cand) { $cand.FullName } else { '' }
  }
  if (-not $dp -or (Test-Zero $dp) -ne 'HASDATA') { "DONOR-MISS: $($row.t)"; $bad++; continue }
  $tz = Test-Zero $tp
  if ($tz -ne 'ZERO' -and $tz -ne 'FAIL') { "SKIP nonzero: $($row.t)"; continue }
  try {
    $fi = Get-Item -LiteralPath $tp -Force
    $wt=$fi.LastWriteTime; $ct=$fi.CreationTime
    [IO.File]::WriteAllBytes($tp, [IO.File]::ReadAllBytes($dp))
    (Get-Item -LiteralPath $tp -Force).LastWriteTime = $wt
    $ok++; "OK: $($row.t)"
  } catch { "FAIL: $($row.t) $($_.Exception.Message)"; $bad++ }
}
"retry2 done ok=$ok bad=$bad"
