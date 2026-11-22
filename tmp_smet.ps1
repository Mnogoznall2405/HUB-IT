$ErrorActionPreference = 'Continue'
foreach ($p in '\\10.103.0.170\Common\Сметный отдел\Для Абдуловой Л.М', '\\10.103.0.170\Common\Сметный отдел\!!!!!Текущие выполнения', '\\10.103.0.170\Common\Сметный отдел\01. ОБЪЕКТЫ', '\\10.103.0.170\Common\Сметный отдел\0000 ОБМЕН') {
  "=== $p ==="
  Get-ChildItem -LiteralPath $p -Force -ErrorAction SilentlyContinue | Select-Object Mode, LastWriteTime, Name | Format-Table -AutoSize | Out-String -Width 180
}
