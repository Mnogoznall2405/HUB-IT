Get-Process | Where-Object { $_.ProcessName -like '*HUB*' } |
    Select-Object Id, ProcessName, Path, MainWindowTitle | Format-List
