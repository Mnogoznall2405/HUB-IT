param([int]$ProcessId = 0)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$auto = [System.Windows.Automation.AutomationElement]
$root = $auto::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)
$win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
if ($null -eq $win) { Write-Output "window not found"; exit 1 }
$lists = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::List)))
foreach ($l in $lists) {
    Write-Output ("=== list '" + $l.Current.Name + "' ===")
    $items = $l.FindAll([System.Windows.Automation.TreeScope]::Children,
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::ListItem)))
    $i = 0
    foreach ($it in $items) {
        Write-Output ("--- item " + $i + " name='" + $it.Current.Name + "'")
        $desc = $it.FindAll([System.Windows.Automation.TreeScope]::Descendants,
            [System.Windows.Automation.Condition]::TrueCondition)
        foreach ($d in $desc) {
            $ct = $d.Current.ControlType.ProgrammaticName
            Write-Output ("      " + $ct + " '" + $d.Current.Name + "'")
        }
        $i++
    }
}
