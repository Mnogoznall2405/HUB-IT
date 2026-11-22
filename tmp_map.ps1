$ErrorActionPreference = 'Continue'
'=== shares on 10.103.0.170 ==='
try { Get-SmbShare -CimSession 10.103.0.170 -ErrorAction Stop | Select-Object Name, Path | Format-Table -AutoSize | Out-String } catch { 'Get-SmbShare failed: ' + $_.Exception.Message }
try { net view \\10.103.0.170 2>&1 | Out-String } catch {}

'=== siblings in \\10.103.0.170\Common\IT ==='
Get-ChildItem -LiteralPath '\\10.103.0.170\Common\IT' -Force -ErrorAction SilentlyContinue | Select-Object Mode, LastWriteTime, Name | Format-Table -AutoSize | Out-String -Width 200

'=== siblings in \\10.103.0.170\Common ==='
Get-ChildItem -LiteralPath '\\10.103.0.170\Common' -Directory -Force -ErrorAction SilentlyContinue | Select-Object LastWriteTime, Name | Format-Table -AutoSize | Out-String -Width 200

'=== @GMT snapshot probe ==='
try {
  $gmt = Get-ChildItem -LiteralPath '\\10.103.0.170\Common' -Force -ErrorAction Stop | Where-Object Name -like '@GMT*'
  if ($gmt) { $gmt | ForEach-Object { $_.FullName } } else { 'no @GMT entries visible in listing' }
} catch { 'GMT probe failed' }
