$ErrorActionPreference = 'Continue'
$lpRoot = '\\?\UNC\10.103.0.170\Common\IT\Абдулова Л.М'
$d = Import-Csv 'C:\Project\HUB-IT-main\scan_all.csv' -Delimiter ';'

# donor index: name|size -> first HASDATA path
$donorIdx = @{}
foreach ($r in $d) {
  if ($r.status -ne 'HASDATA') { continue }
  $name = ($r.relpath -split '\\')[-1]
  $k = $name + '|' + $r.size
  if (-not $donorIdx.ContainsKey($k)) { $donorIdx[$k] = $r.relpath }
}

function Test-Zero($p) {
  # quick 3-position nonzero check; returns 'ZERO'|'HASDATA'|'FAIL'
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

$log = 'C:\Project\HUB-IT-main\restore_log1.csv'
'target;size;donor;result' | Out-File $log -Encoding UTF8
$restored=0; $skipped=0; $failed=0; $nodonor=0
foreach ($r in $d) {
  if ($r.status -ne 'ALLZERO') { continue }
  $name = ($r.relpath -split '\\')[-1]
  $k = $name + '|' + $r.size
  $tp = $lpRoot + $r.relpath
  if (-not $donorIdx.ContainsKey($k)) { $nodonor++; '{0};{1};;NODONOR' -f ($r.relpath -replace ';',','), $r.size | Out-File $log -Append -Encoding UTF8; continue }
  $dp = $lpRoot + $donorIdx[$k]
  # donor sanity: must still have data
  if ((Test-Zero $dp) -ne 'HASDATA') { $nodonor++; '{0};{1};{2};DONOR-BAD' -f ($r.relpath -replace ';',','), $r.size, ($donorIdx[$k] -replace ';',',') | Out-File $log -Append -Encoding UTF8; continue }
  # target check: only overwrite if still fully zero
  $tz = Test-Zero $tp
  if ($tz -ne 'ZERO' -and $tz -ne 'FAIL') { $skipped++; '{0};{1};{2};SKIP-TARGET-NOTZERO' -f ($r.relpath -replace ';',','), $r.size, ($donorIdx[$k] -replace ';',',') | Out-File $log -Append -Encoding UTF8; continue }
  try {
    $fi = Get-Item -LiteralPath $tp -Force
    $wt = $fi.LastWriteTime; $ct = $fi.CreationTime
    $bytes = [IO.File]::ReadAllBytes($dp)
    [IO.File]::WriteAllBytes($tp, $bytes)
    $fi2 = Get-Item -LiteralPath $tp -Force
    $fi2.LastWriteTime = $wt; $fi2.CreationTime = $ct
    $restored++
    '{0};{1};{2};RESTORED' -f ($r.relpath -replace ';',','), $r.size, ($donorIdx[$k] -replace ';',',') | Out-File $log -Append -Encoding UTF8
  } catch {
    $failed++
    '{0};{1};{2};WRITE-FAIL:{3}' -f ($r.relpath -replace ';',','), $r.size, ($donorIdx[$k] -replace ';',','), ($_.Exception.Message -replace ';',':') | Out-File $log -Append -Encoding UTF8
  }
}
"DONE restored=$restored skipped=$skipped failed=$failed nodonor=$nodonor"
