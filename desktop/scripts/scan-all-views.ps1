$dir = 'C:\Project\HUB-IT-main\desktop\Hub.Desktop\Native\Views'
$scan = 'C:\Project\HUB-IT-main\desktop\scripts\scan-itemscontrol.ps1'
foreach ($p in (Get-ChildItem (Join-Path $dir '*.xaml'))) {
    Write-Output ('=== ' + $p.Name)
    & powershell -NoProfile -File $scan -Path $p.FullName
}
