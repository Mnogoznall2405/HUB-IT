$ErrorActionPreference='Continue'
$itDir = Get-ChildItem '\\10.103.0.170\Common\IT' -Directory | Where-Object { $_.Name -match '^\u0410\u0431\u0434\u0443' } | Select-Object -First 1
$lpRoot = '\\?\UNC\10.103.0.170\Common\IT\' + $itDir.Name

# 1) sample restored files from all logs -> check head bytes
$restored = New-Object System.Collections.Generic.List[string]
foreach($lg in 'restore_log1.csv','restore_log3.csv','restore_log4.csv','restore_log5.csv'){
  foreach($line in [IO.File]::ReadLines("C:\Project\HUB-IT-main\$lg")){
    $f=$line -split ';'; if($f.Count -lt 4){continue}
    if(($f[-1]) -match 'RESTORED|VERSION'){ $restored.Add($f[0]) }
  }
}
"logged restores: $($restored.Count)"
$rnd = Get-Random; $seed=42
$sample = $restored | Get-Random -Count 60 -SetSeed $seed
$ok=0;$zeros=@();$missing=0
foreach($rel in $sample){
  $tp = $lpRoot + $rel
  if(-not [IO.File]::Exists($tp)){ $tp = $lpRoot + ($rel -replace ',',';') }
  if(-not [IO.File]::Exists($tp)){ $missing++; continue }
  $b=New-Object byte[] 16; $fs=[IO.File]::OpenRead($tp);$n=$fs.Read($b,0,16);$fs.Close()
  $nz=($b[0..($n-1)] | Where-Object {$_ -ne 0}).Count
  if($nz -gt 0){$ok++} else {$zeros += $rel}
}
"sample60: ok=$ok zero=$($zeros.Count) missing=$missing"
$zeros | Select-Object -First 8 | ForEach-Object {"Z: $_"}

# 2) quick hunt: any zero file left outside dest folder? sample 400 files recursively via cmd dir /s /b is slow; use .NET enumeration with random dirs
$all = [IO.Directory]::EnumerateFiles($lpRoot,'*',[IO.SearchOption]::AllDirectories)
$destName = -join (0x043D,0x0435,0x20,0x043D,0x0430,0x0439,0x0434,0x0435,0x043D,0x044B | ForEach-Object {[char]$_})
$list = New-Object System.Collections.Generic.List[string]
foreach($p in $all){ if($p -notlike "*\$destName\*"){ $list.Add($p) }; if($list.Count -ge 3000){break} }
"main-tree sample: $($list.Count)"
$chk=0;$zleft=0
foreach($p in ($list | Get-Random -Count 150 -SetSeed 7)){
  try{
    $b=New-Object byte[] 64; $fs=[IO.File]::OpenRead($p);$n=$fs.Read($b,0,64);$fs.Close()
    if($n -gt 0 -and (($b[0..($n-1)] | Where-Object {$_ -ne 0}).Count -eq 0)){ $zleft++; "ZERO-LEFT: $p" }
    $chk++
  }catch{}
}
"checked=$chk zeroLeft=$zleft"
