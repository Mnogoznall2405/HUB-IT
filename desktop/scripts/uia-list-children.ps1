param([string]$ListName = '')
. $PSScriptRoot\_uia-root.ps1
$root = Get-HubRoot
if (-not $root) { Write-Output 'no window'; exit 1 }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$list = $null
foreach ($e in $all) {
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::List -and $e.Current.Name -eq $ListName) { $list = $e; break }
}
if (-not $list) { Write-Output 'list not found'; exit 1 }
$kids = $list.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$i = 0
foreach ($k in $kids) {
    if ($i++ -ge 12) { break }
    $n = $k.Current.Name
    Write-Output ($k.Current.ControlType.ProgrammaticName + ' | ' + $n.Substring(0, [Math]::Min(60, $n.Length)))
}
