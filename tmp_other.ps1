$ErrorActionPreference = 'Continue'
$today = Get-Date '2026-11-19'
$dirs = @('\\10.103.0.170\Common\Договорный отдел', '\\10.103.0.170\Common\Отдел контроллинга', '\\10.103.0.170\Common\УЛиСУ ТМЦ', '\\10.103.0.170\Common\IT\test')
foreach ($d in $dirs) {
  "=== $d ==="
  $found = @(Get-ChildItem -LiteralPath $d -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.CreationTime -ge $today } | Select-Object -First 5)
  if (-not $found) {
    # look one level deep
    $found = @(Get-ChildItem -LiteralPath $d -Directory -Force -ErrorAction SilentlyContinue | Select-Object -First 10 | ForEach-Object {
      Get-ChildItem -LiteralPath $_.FullName -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.CreationTime -ge $today }
    } | Select-Object -First 5)
  }
  foreach ($f in $found) {
    $h = ''
    try { $fs=[IO.File]::OpenRead($f.FullName); $b=New-Object byte[] 16; $r=$fs.Read($b,0,16); $fs.Close(); $h = ($b[0..([Math]::Max(0,$r-1))] | %{$_.ToString('X2')}) -join ' ' } catch { $h='READFAIL' }
    '{0,10} | C:{1:HH:mm} | {2} | {3}' -f $f.Length, $f.CreationTime, $h, $f.Name
  }
}
