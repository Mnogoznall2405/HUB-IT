param([int]$ProcessId = 0)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$auto = [System.Windows.Automation.AutomationElement]
$root = $auto::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)
$win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
if ($null -eq $win) { Write-Output "window not found"; exit 1 }
$wp = $win.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
Write-Output ("state: " + $wp.Current.WindowVisualState)
if ($wp.Current.WindowVisualState -ne [System.Windows.Automation.WindowVisualState]::Normal) {
    $wp.SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Normal)
    Start-Sleep -Milliseconds 700
    Write-Output "restored"
}
