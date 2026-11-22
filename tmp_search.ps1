$ErrorActionPreference = 'Continue'
'=== Сметный отдел top ==='
Get-ChildItem -LiteralPath '\\10.103.0.170\Common\Сметный отдел' -Force -ErrorAction SilentlyContinue | Select-Object Mode, LastWriteTime, Name | Format-Table -AutoSize | Out-String -Width 200
'=== Обмен * folders mentioning смет/Абд ==='
Get-ChildItem -LiteralPath '\\10.103.0.170\Common' -Directory -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'Обмен|Смет' } | ForEach-Object { $_.FullName }
