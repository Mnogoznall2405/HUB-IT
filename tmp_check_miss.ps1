$itDir = Get-ChildItem '\\10.103.0.170\Common\IT' -Directory | Where-Object { $_.Name -match '^\u0410\u0431\u0434\u0443' } | Select-Object -First 1
$lpRoot = '\\?\UNC\10.103.0.170\Common\IT\' + $itDir.Name
$dest = $lpRoot + '\' + -join (0x043D,0x0435,0x20,0x043D,0x0430,0x0439,0x0434,0x0435,0x043D,0x044B | ForEach-Object {[char]$_})

$misses = Select-String -Path 'C:\Project\HUB-IT-main\move_log.csv' -Pattern 'SRC-MISS' | ForEach-Object { ($_.Line -split ';SRC-MISS')[0] }
"src-miss count: $($misses.Count)"

# duplicates in remaining list?
$cnt = @{}
foreach($m in $misses){ $cnt[$m]++ }
"dup log entries: $(($cnt.Values | Where-Object {$_ -gt 1}).Count)"

$inDest=0; $inOrig=0; $nowhere=@()
foreach($m in $misses){
  $rel = $m.TrimStart('\')
  # try both semicolon and comma variants
  $d1 = $dest + '\' + $rel
  $o1 = $lpRoot + '\' + $rel
  $d2 = $dest + '\' + ($rel -replace ',',';')
  $o2 = $lpRoot + '\' + ($rel -replace ',',';')
  if([IO.File]::Exists($d1) -or [IO.File]::Exists($d2)){ $inDest++; continue }
  if([IO.File]::Exists($o1) -or [IO.File]::Exists($o2)){ $inOrig++; continue }
  $nowhere += $m
}
"inDest=$inDest  inOrig=$inOrig  nowhere=$($nowhere.Count)"
$nowhere | Select-Object -First 10 | ForEach-Object { "GONE: $_" }
