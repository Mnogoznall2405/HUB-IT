param(
    [string]$ProcessName = 'HUB.Desktop',
    [int]$ItemIndex = 0,
    [string]$Mode = 'select-first-item'
)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { 'no process'; exit 1 }
$cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $proc.Id)
$win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
if (-not $win) { 'no window'; exit 1 }

if ($Mode -eq 'select-first-item') {
    $lbCond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::List)
    $lists = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $lbCond)
    "lists found: $($lists.Count)"
    if ($lists.Count -lt 1) { exit 1 }
    $itemCond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::ListItem)
    $items = $lists[0].FindAll([System.Windows.Automation.TreeScope]::Children, $itemCond)
    "items in list0: $($items.Count)"
    if ($items.Count -le $ItemIndex) { exit 1 }
    $el = $items[$ItemIndex]
    try {
        $inv = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        if ($inv) { $inv.Invoke(); 'invoked item'; exit 0 }
    } catch {}
    try {
        $sel = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
        if ($sel) { $sel.Select(); 'selected item'; exit 0 }
    } catch {}
    'no pattern'
    exit 1
}
