param([Parameter(Mandatory = $true)][string]$ItemName)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process HUB.Desktop | Select-Object -First 1
$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children,
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)))
foreach ($w in $wins) {
    $mis = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::MenuItem)))
    foreach ($mi in $mis) {
        if ($mi.Current.Name -eq $ItemName -and $mi.Current.IsEnabled -and -not $mi.Current.IsOffscreen) {
            try { $mi.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); Write-Output "invoked: $ItemName"; exit 0 } catch { Write-Output "invoke failed: $_"; exit 1 }
        }
    }
}
Write-Output "menuitem not found: $ItemName"
exit 1
