param(
    [Parameter(Mandatory=$true)][string]$ListName,
    [int]$ItemIndex = 0,
    [int]$ProcessId = 0
)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$auto = [System.Windows.Automation.AutomationElement]
$root = $auto::RootElement
$win = $null
if ($ProcessId -gt 0) {
    $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)
    $win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
} else {
    $titleCond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty, "HUB Desktop")
    $win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $titleCond)
}
if ($null -eq $win) { Write-Output "window not found"; exit 1 }
$listCond = New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::List)),
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty, $ListName)))
$list = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $listCond)
if ($null -eq $list) { Write-Output "list '$ListName' not found"; exit 2 }
$itemCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::ListItem)
$items = $list.FindAll([System.Windows.Automation.TreeScope]::Children, $itemCond)
Write-Output ("items: " + $items.Count)
if ($items.Count -le $ItemIndex) { exit 3 }
$el = $items[$ItemIndex]
try {
    $sel = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
    if ($null -ne $sel) { $sel.Select(); Write-Output "selected"; exit 0 }
} catch { Write-Output ("sel err: " + $_.Exception.Message) }
try {
    $inv = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    if ($null -ne $inv) { $inv.Invoke(); Write-Output "invoked"; exit 0 }
} catch { Write-Output ("inv err: " + $_.Exception.Message) }
Write-Output "no pattern"
exit 4
