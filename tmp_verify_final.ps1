$itDir = Get-ChildItem '\\10.103.0.170\Common\IT' -Directory | Where-Object { $_.Name -match '^\u0410\u0431\u0434\u0443' } | Select-Object -First 1
$lpRoot = '\\?\UNC\10.103.0.170\Common\IT\' + $itDir.Name
$destName = -join (0x043D,0x0435,0x20,0x043D,0x0430,0x0439,0x0434,0x0435,0x043D,0x044B | ForEach-Object {[char]$_})
$dest = $lpRoot + '\' + $destName
"folder exists: $([IO.Directory]::Exists($dest))"

# count files inside via UNC
$cnt = 0
try {
  $fso = New-Object -ComObject Scripting.FileSystemObject
  $cnt = ($fso.GetFolder($dest)).Files.Count
  $sub = 0
  function Walk($f){ $script:cnt += $f.Files.Count; foreach($s in $f.SubFolders){ Walk $s } }
  Walk ($fso.GetFolder($dest))
} catch { "fso err: $_" }
"files in dest folder: $cnt"

# total restored per logs
$tot=0;$ver=0
foreach($lg in 'restore_log1.csv','restore_log3.csv','restore_log4.csv','restore_log5.csv','restore_log6.csv'){
  foreach($line in [IO.File]::ReadLines("C:\Project\HUB-IT-main\$lg")){
    $r=($line -split ';')[-1]
    if($r -eq 'RESTORED'){$tot++}
    elseif($r -match 'VERSION'){$ver++}
  }
}
"exact restores: $tot + 10 (retry6) ; version restores: $ver"
$moved = (Select-String -Path 'C:\Project\HUB-IT-main\move_log.csv' -Pattern ';MOVED$').Count
"moved to 'not found': $moved"
