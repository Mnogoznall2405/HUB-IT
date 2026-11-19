param(
    [Parameter(Mandatory=$true)][string]$ListName,
    [int]$ItemIndex = 0,
    [int]$ProcessId = 0
)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$auto = [System.Windows.Automation.AutomationElement]
$root = $auto::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)
$win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
if ($null -eq $win) { Write-Output "window not found"; exit 1 }
$listCond = New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::List)),
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty, $ListName)))
$list = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $listCond)
if ($null -eq $list) { Write-Output "list not found"; exit 2 }
$itemCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::ListItem)
$items = $list.FindAll([System.Windows.Automation.TreeScope]::Children, $itemCond)
if ($items.Count -le $ItemIndex) { Write-Output ("items: " + $items.Count); exit 3 }
$item = $items[$ItemIndex]
$btnCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button)
$btn = $item.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $btnCond)
if ($null -eq $btn) { Write-Output "no inner button"; exit 4 }
$btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
Write-Output ("invoked: " + $btn.Current.Name)
