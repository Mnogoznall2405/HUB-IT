$l = Get-Content 'C:\Project\HUB-IT-main\move_log.csv' -Encoding UTF8
"lines: $($l.Count)"
$l | Select-Object -Skip 1 | Group-Object { ($_ -split ';')[-1] -replace ':.*','' } | Select-Object Name,Count | Format-Table -AutoSize
Get-Item 'C:\Project\HUB-IT-main\move_log.csv' | Select-Object LastWriteTime
