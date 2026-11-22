$ErrorActionPreference = 'Continue'
$itDir = Get-ChildItem '\\10.103.0.170\Common\IT' -Directory | Where-Object { $_.Name -match '^\u0410\u0431\u0434\u0443' } | Select-Object -First 1
$lpRoot = '\\?\UNC\10.103.0.170\Common\IT\' + $itDir.Name
$destName = -join (0x043D,0x0435,0x20,0x043D,0x0430,0x0439,0x0434,0x0435,0x043D,0x044B | ForEach-Object {[char]$_})
$dest = $lpRoot + '\' + $destName

$misses = Select-String -Path 'C:\Project\HUB-IT-main\move_log.csv' -Pattern 'SRC-MISS' | ForEach-Object { ($_.Line -split ';SRC-MISS')[0].TrimStart('\') }

function Resolve-RealPath([string]$root,[string]$rel){
  $cur = $root
  foreach($seg in ($rel -split '\\')){
    $kids = [IO.Directory]::GetFileSystemEntries($cur) | ForEach-Object { Split-Path $_ -Leaf }
    $hit = $kids | Where-Object { $_ -eq $seg } | Select-Object -First 1
    if(-not $hit){ $hit = $kids | Where-Object { ($_ -replace ';',',') -eq $seg } | Select-Object -First 1 }
    if(-not $hit){ $hit = $kids | Where-Object { $_ -eq ($seg -replace ',',';') } | Select-Object -First 1 }
    if(-not $hit){ return $null }
    $cur = $cur + '\' + $hit
  }
  return $cur
}

$moved=0;$gone=@()
foreach($m in $misses){
  $real = Resolve-RealPath $lpRoot $m
  if(-not $real){ $gone += $m; continue }
  $realRel = $real.Substring($lpRoot.Length).TrimStart('\')
  $dst = $dest + '\' + $realRel
  try {
    $dstDir = Split-Path $dst -Parent
    if(-not [IO.Directory]::Exists($dstDir)){ [IO.Directory]::CreateDirectory($dstDir) | Out-Null }
    [IO.File]::Move($real, $dst)
    $moved++
    "$realRel;MOVED" | Out-File 'C:\Project\HUB-IT-main\move_log.csv' -Append -Encoding UTF8
  } catch { "MOVEFAIL $realRel :: $($_.Exception.Message)" }
}
"moved=$moved still-gone=$($gone.Count)"
$gone | ForEach-Object { "GONE: $_" }
