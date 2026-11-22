$ErrorActionPreference = 'Continue'
$smet = '\\?\UNC\10.103.0.170\Common\Сметный отдел'
'=== sample heads in Для Абдуловой ==='
Get-ChildItem -LiteralPath ($smet + '\Для Абдуловой Л.М') -File -Force -ErrorAction SilentlyContinue | Select-Object -First 8 | ForEach-Object {
  try { $fs=[IO.File]::OpenRead($_.FullName); $b=New-Object byte[] 8; $r=$fs.Read($b,0,8); $fs.Close(); $h=($b[0..([Math]::Max(0,$r-1))]|%{$_.ToString('X2')}) -join ' ' } catch { $h='READFAIL' }
  '{0,9} | {1} | {2}' -f $_.Length, $h, $_.Name
}
'=== counting files in Сметный отдел ==='
$sw = [Diagnostics.Stopwatch]::StartNew()
$all = @(Get-ChildItem -LiteralPath $smet -Recurse -File -Force -ErrorAction SilentlyContinue)
"files: $($all.Count) in $($sw.Elapsed.TotalSeconds)s"
$all | ForEach-Object { '{0};{1};{2}' -f $_.Name, $_.Length, ($_.FullName.Substring($smet.Length)) } | Out-File 'C:\Project\HUB-IT-main\smet_index.csv' -Encoding UTF8
'index written'
