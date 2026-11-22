param([int]$Mod=6,[int]$Slice=0)
$ErrorActionPreference = 'Continue'
$lpRoot = '\\?\UNC\10.103.0.170\Common\IT\Абдулова Л.М'
$files = @(Get-ChildItem -LiteralPath $lpRoot -Recurse -File -Force -ErrorAction SilentlyContinue)
$csv = "C:\Project\HUB-IT-main\scan_s$Slice.csv"
'relpath;size;status;headhex' | Out-File $csv -Encoding UTF8
$i = 0; $n = 0
foreach ($f in $files) {
  if (($i % $Mod) -ne $Slice) { $i++; continue }
  $i++; $n++
  $rel = $f.FullName.Substring($lpRoot.Length)
  $status='OK'; $headhex=''
  if ($f.Length -eq 0) { $status='EMPTY' }
  else {
    try {
      $fs=[IO.File]::OpenRead($f.FullName); $b=New-Object byte[] 64
      $r=$fs.Read($b,0,64); $fs.Close()
      if ($r -le 0) { $status='EMPTY' }
      else {
        $nz=0; for($j=0;$j -lt $r;$j++){ if($b[$j] -ne 0){$nz++} }
        $headhex = ($b[0..([Math]::Min(15,$r-1))] | %{$_.ToString('X2')}) -join ' '
        $status = if ($nz -eq 0) {'ALLZERO'} else {'HASDATA'}
      }
    } catch { $status='READFAIL' }
  }
  '{0};{1};{2};{3}' -f ($rel -replace ';',','), $f.Length, $status, $headhex | Out-File $csv -Append -Encoding UTF8
  if (($n % 1000) -eq 0) { Write-Output "$n done" }
}
Write-Output ("SLICE $Slice DONE total=$n")
