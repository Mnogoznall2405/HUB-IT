$ErrorActionPreference = 'Continue'
$lpRoot = '\\?\UNC\10.103.0.170\Common\IT\Абдулова Л.М'
$outRoot = $lpRoot + '\!_спасенные_превью'
$d = Import-Csv 'C:\Project\HUB-IT-main\scan_all.csv' -Delimiter ';'
$tbs = $d | Where-Object { $_.relpath -like '*Thumbs.db' -and $_.status -eq 'HASDATA' }
"live Thumbs.db: $($tbs.Count)"
$made = @{}
$total = 0
foreach ($t in $tbs) {
  $src = $lpRoot + $t.relpath
  try { $b = [IO.File]::ReadAllBytes($src) } catch { continue }
  $dirRel = ($t.relpath -replace '\\[^\\]+$','')
  $i = 0; $n = 0
  while ($i -lt $b.Length - 3) {
    if ($b[$i] -eq 0xFF -and $b[$i+1] -eq 0xD8 -and $b[$i+2] -eq 0xFF) {
      $j = $i + 3
      while ($j -lt $b.Length - 1) { if ($b[$j] -eq 0xFF -and $b[$j+1] -eq 0xD9) { break }; $j++ }
      if ($j -lt $b.Length - 1) {
        $n++
        $od = $outRoot + $dirRel
        if (-not $made[$od]) { New-Item -ItemType Directory -Path $od -Force | Out-Null; $made[$od]=$true }
        $slice = $b[$i..($j+1)]
        [IO.File]::WriteAllBytes(($od + '\thumb_' + $n.ToString('D3') + '.jpg'), $slice)
        $total++
        $i = $j + 2; continue
      }
    }
    $i++
  }
}
"carved jpgs: $total"
