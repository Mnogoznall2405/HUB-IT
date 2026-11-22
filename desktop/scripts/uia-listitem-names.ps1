param([string]$ListName = '', [int]$Max = 6)
. $PSScriptRoot\_uia-root.ps1
$root = Get-HubRoot
if (-not $root) { Write-Output 'no window'; exit 1 }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$list = $null
foreach ($e in $all) {
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::List -and $e.Current.Name -eq $ListName) { $list = $e; break }
}
if (-not $list) { Write-Output 'list not found'; exit 1 }
$items = $list.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$i = 0
foreach ($it in $items) {
    $ct = $it.Current.ControlType.ProgrammaticName
    if ($ct -eq 'ControlType.ListItem' -or $ct -eq 'ControlType.GroupItem') {
        $n = $it.Current.Name
        Write-Output ($ct + ' | ' + $n)
        $i++
        if ($i -ge $Max) { break }
    }
}
