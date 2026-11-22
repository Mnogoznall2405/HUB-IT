$ErrorActionPreference = 'Continue'
$root = (Get-ChildItem -LiteralPath '\\10.103.0.170\Common\IT' -Directory -Force | Where-Object { $_.Name -match 'Абдулова' })[0].FullName
$files = @(Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue)

'=== suspicious artifact files ==='
$files | Where-Object { $_.Extension -in '.original','.sign','.sig','.tmp1','.err','.lic','.bak' } |
  Select-Object -First 60 FullName, Length, CreationTime, LastWriteTime |
  Format-List | Out-String -Width 250

'=== creation vs write time (first 40 files) ==='
$files | Select-Object -First 40 |
  ForEach-Object { '{0} | C:{1:dd.MM.yyyy HH:mm} W:{2:dd.MM.yyyy HH:mm} | {3}' -f $_.Length, $_.CreationTime, $_.LastWriteTime, $_.Name }

'=== deep read: nonzero regions in zero-head files ==='
$zeroHead = $files | Where-Object { $_.Extension -in '.xlsx','.pdf','.gsfx','.jpg','.rar','.doc','.hydra' } | Select-Object -First 30
foreach ($f in $zeroHead) {
  try {
    $fs = [IO.File]::OpenRead($f.FullName)
    $len = $fs.Length
    $nonzero = 0; $checked = 0
    $buf = New-Object byte[] 4096
    foreach ($pos in @(0, [long]($len*0.25), [long]($len*0.5), [long]($len*0.75), [long]([Math]::Max(0,$len-4096)))) {
      if ($pos -ge $len) { continue }
      $fs.Position = $pos
      $r = $fs.Read($buf,0,4096)
      $checked += $r
      for ($i=0; $i -lt $r; $i++) { if ($buf[$i] -ne 0) { $nonzero++ } }
    }
    $fs.Close()
    '{0,8} bytes | nonzero {1}/{2} | {3}' -f $len, $nonzero, $checked, $f.Name
  } catch { 'READFAIL | ' + $f.Name }
}

'=== attributes/reparse check on 15 files ==='
$files | Select-Object -First 15 | ForEach-Object { '{0} | {1}' -f $_.Attributes, $_.Name }

'=== all txt/html/log names (possible notes) ==='
$files | Where-Object { $_.Extension -in '.txt','.html','.htm','.log','.ini','.csv','.ru' } |
  ForEach-Object { '{0} | {1}' -f $_.Length, $_.FullName.Substring($root.Length) }
