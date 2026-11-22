$ErrorActionPreference = 'Continue'
$itDir = Get-ChildItem '\\10.103.0.170\Common\IT' -Directory | Where-Object { $_.Name -match '^\u0410\u0431\u0434\u0443' } | Select-Object -First 1
$lpRoot = '\\?\UNC\10.103.0.170\Common\IT\' + $itDir.Name

$d = Import-Csv 'C:\Project\HUB-IT-main\scan_all.csv' -Delimiter ';'
$done=@{}
$restoredCount=0;$verCount=0
foreach($lg in 'restore_log1.csv','restore_log3.csv','restore_log4.csv','restore_log5.csv','restore_log6.csv'){
  if(-not (Test-Path "C:\Project\HUB-IT-main\$lg")){continue}
  foreach($line in [IO.File]::ReadLines("C:\Project\HUB-IT-main\$lg")){
    $f=$line -split ';'
    if($f.Count -lt 4){continue}
    $res=$f[$f.Count-1]
    if($res -eq 'RESTORED'){ $restoredCount++; $done[$f[0]]=$true }
    elseif($res -match 'VERSION'){ $verCount++; $done[$f[0]]=$true }
  }
}
"RESTORED-exact: $restoredCount  VERSION: $verCount"

# log entries used relpath with ;->, ; match back to real relpaths via name+size
$rem = New-Object System.Collections.Generic.List[object]
foreach($r in $d){
  if($r.status -ne 'ALLZERO'){continue}
  $key = ($r.relpath -replace ';',',')
  if(-not $done[$key]){ $rem.Add($r) }
}
# also files restored via retry scripts (not in logs): re-verify a sample later; count via direct zero-check on a sample is too slow.
# Instead: those restored in retry15/retry2 were the WRITE-FAIL ones; the 10 of log6 were logged as WRITE-FAIL not RESTORED.
# Deduplicate: count remaining whose relpath-with-commas is NOT in done.
"remaining-ALLZERO-by-log: $($rem.Count)"

# export remaining list for the user
$out = 'C:\Project\HUB-IT-main\remaining_zeroed.csv'
'relpath;size' | Out-File $out -Encoding UTF8
foreach($r in $rem){ '{0};{1}' -f ($r.relpath -replace ';',','), $r.size | Out-File $out -Append -Encoding UTF8 }
"exported: $out"

# signature spot-check: sample 25 restored files of different types
$samples = @()
$done.Keys | Group-Object { ($_ -split '\\')[-1] -replace '.*\.','.' } | ForEach-Object { $samples += $_.Group | Select-Object -First 4 }
$sig=@{'PK'='zip/xlsx/gsfx';'%PDF'='pdf';'Rar!'='rar';'AC'='dwg';[char]0xFF+'D8'='jpg'}
$ok=0;$bad=@()
foreach($rel in ($samples | Select-Object -First 30)){
  # undo comma->semicolon ambiguity: try as-is first
  $tp = $lpRoot + $rel
  if(-not [IO.File]::Exists($tp)){ $tp = $lpRoot + ($rel -replace ',',';') }
  if(-not [IO.File]::Exists($tp)){ continue }
  try {
    $b=New-Object byte[] 8; $fs=[IO.File]::OpenRead($tp);$n=$fs.Read($b,0,8);$fs.Close()
    $hex = ($b[0..($n-1)] | ForEach-Object {'{0:X2}' -f $_}) -join ''
    if($hex -match '^00+$'){ $bad += $rel } else { $ok++ }
  } catch { }
}
"signature spot-check: ok=$ok bad=$($bad.Count)"
$bad | ForEach-Object { "STILL-ZERO: $_" }
