$ErrorActionPreference = 'Continue'
$itDir = Get-ChildItem '\\10.103.0.170\Common\IT' -Directory | Where-Object { $_.Name -match '^\u0410\u0431\u0434\u0443' } | Select-Object -First 1
$lpRoot = '\\?\UNC\10.103.0.170\Common\IT\' + $itDir.Name
$dest = $lpRoot + '\' + [char]0x043D + [char]0x0435 + ' ' + [char]0x043D + [char]0x0430 + [char]0x0439 + [char]0x0434 + [char]0x0435 + [char]0x043D + [char]0x044B   # "не найдены"
"dest: $dest"

$d = Import-Csv 'C:\Project\HUB-IT-main\scan_all.csv' -Delimiter ';'
$done=@{}
foreach($lg in 'restore_log1.csv','restore_log3.csv','restore_log4.csv','restore_log5.csv','restore_log6.csv'){
  if(-not (Test-Path "C:\Project\HUB-IT-main\$lg")){continue}
  foreach($line in [IO.File]::ReadLines("C:\Project\HUB-IT-main\$lg")){
    $f=$line -split ';'
    if($f.Count -lt 4){continue}
    $res=$f[$f.Count-1]
    if($res -eq 'RESTORED' -or $res -match 'VERSION'){ $done[$f[0]]=$true }
  }
}

$rem = New-Object System.Collections.Generic.List[object]
foreach($r in $d){
  if($r.status -ne 'ALLZERO'){continue}
  $key = ($r.relpath -replace ';',',')
  if(-not $done[$key]){ $rem.Add($r) }
}
"remaining ALLZERO: $($rem.Count)"

# export list before moving
$out = 'C:\Project\HUB-IT-main\remaining_zeroed.csv'
'relpath;size' | Out-File $out -Encoding UTF8
foreach($r in $rem){ '{0};{1}' -f ($r.relpath -replace ';',','), $r.size | Out-File $out -Append -Encoding UTF8 }

$moved=0;$movedFail=0;$stillHasData=0
$moveLog = 'C:\Project\HUB-IT-main\move_log.csv'
if(-not (Test-Path $moveLog)){ 'relpath;result' | Out-File $moveLog -Encoding UTF8 }
$alreadyDone=@{}
foreach($line in [IO.File]::ReadLines($moveLog)){
  if($line -match ';MOVED$'){ $alreadyDone[($line -split ';MOVED')[0]]=$true }
}
foreach($r in $rem){
  $rkey = $r.relpath -replace ';',','
  if($alreadyDone[$rkey]){ $moved++; continue }
  $src = $lpRoot + $r.relpath
  if(-not [IO.File]::Exists($src)){ $src = $lpRoot + ($r.relpath -replace ';',',') }
  if(-not [IO.File]::Exists($src)){ '{0};SRC-MISS' -f ($r.relpath -replace ';',',') | Out-File $moveLog -Append -Encoding UTF8; $movedFail++; continue }
  # safety: skip if file turned out non-zero
  try {
    $fs=[IO.File]::OpenRead($src); $probe=New-Object byte[] 512; $n=$fs.Read($probe,0,512); $fs.Close()
    if(($probe | Where-Object {$_ -ne 0}).Count -gt 0){ $stillHasData++; '{0};SKIP-NOTZERO' -f ($r.relpath -replace ';',',') | Out-File $moveLog -Append -Encoding UTF8; continue }
  } catch { }
  $relClean = $r.relpath.TrimStart('\')
  $dst = $dest + '\' + $relClean
  try {
    $dstDir = Split-Path $dst -Parent
    if(-not [IO.Directory]::Exists($dstDir)){ [IO.Directory]::CreateDirectory($dstDir) | Out-Null }
    [IO.File]::Move($src, $dst)
    $moved++
    '{0};MOVED' -f ($r.relpath -replace ';',',') | Out-File $moveLog -Append -Encoding UTF8
  } catch {
    $movedFail++
    '{0};MOVE-FAIL:{1}' -f ($r.relpath -replace ';',','), ($_.Exception.Message -replace ';',':') | Out-File $moveLog -Append -Encoding UTF8
  }
}
"DONE moved=$moved fail=$movedFail skipNotZero=$stillHasData"
