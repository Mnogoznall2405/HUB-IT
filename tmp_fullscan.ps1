$ErrorActionPreference = 'Continue'
$root = (Get-ChildItem -LiteralPath '\\10.103.0.170\Common\IT' -Directory -Force | Where-Object { $_.Name -match 'Абдулова' })[0].FullName
$files = @(Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue)
$csv = 'C:\Project\HUB-IT-main\scan_result.csv'
'relpath;size;created;writed;headhex;nz_pct;status' | Out-File $csv -Encoding UTF8

$i = 0
foreach ($f in $files) {
  $i++
  $rel = $f.FullName.Substring($root.Length)
  $status = 'OK'; $nz = -1; $headhex = ''
  $len = $f.Length
  if ($len -eq 0) { $status='EMPTY'; $nz=0 }
  else {
    try {
      $fs = [IO.File]::OpenRead($f.FullName)
      $buf = New-Object byte[] 4096
      $nonzero = 0; $checked = 0; $first = $true
      $positions = @(0, [long]($len*0.33), [long]($len*0.66), [long]([Math]::Max(0,$len-4096)))
      foreach ($pos in $positions) {
        if ($pos -ge $len) { continue }
        $fs.Position = $pos
        $r = $fs.Read($buf,0,4096)
        if ($first -and $r -gt 0) { $headhex = ($buf[0..([Math]::Min(15,$r-1))] | ForEach-Object {$_.ToString('X2')}) -join ' '; $first=$false }
        $checked += $r
        for ($j=0;$j -lt $r;$j++) { if ($buf[$j] -ne 0) { $nonzero++ } }
      }
      $fs.Close()
      if ($checked -eq 0) { $status='EMPTY' }
      else { $nz = [math]::Round(100.0*$nonzero/$checked,1); if ($nonzero -eq 0) { $status='ALLZERO' } else { $status='HASDATA' } }
    } catch { $status='READFAIL' }
  }
  '{0};{1};{2:yyyy-MM-dd HH:mm};{3:yyyy-MM-dd HH:mm};{4};{5};{6}' -f ($rel -replace ';',','), $len, $f.CreationTime, $f.LastWriteTime, $headhex, $nz, $status |
    Out-File $csv -Append -Encoding UTF8
  if (($i % 500) -eq 0) { Write-Output "$i / $($files.Count)" }
}
Write-Output ('DONE ' + $files.Count)
