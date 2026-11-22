$ErrorActionPreference = 'Continue'
$today = Get-Date '2026-11-19'
# files created today elsewhere on the share (sample a few folders that show today's LastWriteTime)
$dirs = @('\\10.103.0.170\Common\Договорный отдел', '\\10.103.0.170\Common\Отдел контроллинга', '\\10.103.0.170\Common\УЛиСУ ТМЦ', '\\10.103.0.170\Common\IT\test', '\\10.103.0.170\Common\IT\Admins')
foreach ($d in $dirs) {
  "=== $d ==="
  Get-ChildItem -LiteralPath $d -Recurse -File -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.CreationTime -ge $today } | Select-Object -First 8 |
    ForEach-Object {
      $h = ''
      try { $fs=[IO.File]::OpenRead($_.FullName); $b=New-Object byte[] 16; $r=$fs.Read($b,0,16); $fs.Close(); $h = ($b[0..([Math]::Max(0,$r-1))] | %{$_.ToString('X2')}) -join ' ' } catch { $h='READFAIL' }
      '{0,10} | C:{1:HH:mm} | {2} | {3}' -f $_.Length, $_.CreationTime, $h, $_.Name
    }
}
