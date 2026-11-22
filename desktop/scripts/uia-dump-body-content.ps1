param([int]$MinX = 1000)
. $PSScriptRoot\_uia-root.ps1
$root = Get-HubRoot
if (-not $root) { Write-Output 'no window'; exit 1 }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$body = $null
foreach ($e in $all) {
    $r = $e.Current.BoundingRectangle
    if ($r.X -ge $MinX -and $e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Pane -and $e.Current.Name -like '*веб-содержимое*') {
        $body = $e
    }
}
if (-not $body) { Write-Output 'body webview pane not found'; exit 1 }
$kids = $body.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
Write-Output ('body children: ' + $kids.Count)
$i = 0
foreach ($d in $kids) {
    if ($i++ -ge 40) { break }
    $name = ($d.Current.Name -replace "`n", ' ')
    if ($name.Length -gt 80) { $name = $name.Substring(0, 80) }
    Write-Output ($d.Current.ControlType.ProgrammaticName + ' | ' + $name)
}
