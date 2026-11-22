$ErrorActionPreference = 'Continue'
$root = (Get-ChildItem -LiteralPath '\\10.103.0.170\Common\IT' -Directory -Force | Where-Object { $_.Name -match 'Абдулова' })[0].FullName
$files = @(Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue)

function Probe([string]$p) {
  try {
    $fs=[IO.File]::OpenRead($p); $len=$fs.Length; $buf=New-Object byte[] 4096
    $nz=0;$chk=0;$head=''
    foreach($pos in @(0,[long]($len*0.5),[long]([Math]::Max(0,$len-4096)))){
      if($pos -ge $len){continue}; $fs.Position=$pos; $r=$fs.Read($buf,0,4096); $chk+=$r
      if($pos -eq 0 -and $r -gt 0){$head=($buf[0..([Math]::Min(11,$r-1))]|%{$_.ToString('X2')}) -join ' '}
      for($j=0;$j -lt $r;$j++){if($buf[$j] -ne 0){$nz++}}
    }
    $fs.Close()
    return ('nz{0}/{1} h[{2}]' -f $nz,$chk,$head)
  } catch { return 'READFAIL' }
}

'=== .dwg with .bak/.original siblings ==='
$pairs = $files | Where-Object { $_.Extension -in '.bak','.original' } | Select-Object -First 20
foreach($f in $pairs){
  $probeBak = Probe $f.FullName
  # main file path: strip last extension
  $main = $f.FullName -replace '\.(bak|original)$',''
  $mainState = if (Test-Path -LiteralPath $main) { Probe $main } else { 'NO MAIN FILE' }
  '{0}  |  bak:{1}  |  main:{2}' -f $f.Name, $probeBak, $mainState
}

'=== .tmp1 (GrandSmeta temp) ==='
$files | Where-Object { $_.Extension -eq '.tmp1' } | ForEach-Object { '{0} sz={1} {2}' -f $_.Name, $_.Length, (Probe $_.FullName) }

'=== .sig files - do they embed content? head of big ones ==='
$files | Where-Object { $_.Extension -eq '.sig' -and $_.Length -gt 100000 } | Select-Object -First 8 | ForEach-Object { '{0} sz={1} {2}' -f $_.Name, $_.Length, (Probe $_.FullName) }

'=== Data.sign heads ==='
$files | Where-Object { $_.Name -eq 'Data.sign' } | Select-Object -First 4 | ForEach-Object { '{0} sz={1} {2}' -f $_.FullName.Substring($root.Length), $_.Length, (Probe $_.FullName) }
