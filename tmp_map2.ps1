$ErrorActionPreference = 'Continue'
foreach ($p in '\\10.103.0.170\Common\IT\Users', '\\10.103.0.170\Common\GOLD', '\\10.103.0.170\Common\IT\test', '\\10.103.0.170\Common\IT\Admins', '\\10.103.0.170\Common\IT\old Admins') {
  "=== $p ==="
  Get-ChildItem -LiteralPath $p -Force -ErrorAction SilentlyContinue |
    Select-Object Mode, LastWriteTime, Name | Format-Table -AutoSize | Out-String -Width 200
}
