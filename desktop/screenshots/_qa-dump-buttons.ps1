param([int]$ProcessId = 0)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$auto = [System.Windows.Automation.AutomationElement]
$root = $auto::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)
$win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
if ($null -eq $win) { Write-Output "window not found"; exit 1 }
$btnCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button)
$all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnCond)
Write-Output ("buttons: " + $all.Count)
foreach ($b in $all) {
    $n = $b.Current.Name
    $e = $b.Current.IsEnabled
    $o = $b.Current.IsOffscreen
    $aid = $b.Current.AutomationId
    Write-Output ("  [btn] name='" + $n + "' aid='" + $aid + "' enabled=" + $e + " offscreen=" + $o)
}
