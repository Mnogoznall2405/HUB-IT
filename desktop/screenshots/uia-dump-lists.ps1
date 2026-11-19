param([int]$ProcessId = 0)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$auto = [System.Windows.Automation.AutomationElement]
$root = $auto::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)
$win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
if ($null -eq $win) { Write-Output "window not found"; exit 1 }
$lbCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::List)
$lists = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $lbCond)
Write-Output ("lists: " + $lists.Count)
foreach ($l in $lists) {
    $itemCond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::ListItem)
    $items = $l.FindAll([System.Windows.Automation.TreeScope]::Children, $itemCond)
    Write-Output ("  - '" + $l.Current.Name + "' offscreen=" + $l.Current.IsOffscreen + " items=" + $items.Count)
}
