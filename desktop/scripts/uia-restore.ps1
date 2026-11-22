Add-Type -AssemblyName UIAutomationClient
$p = Get-Process HUB.Desktop | Select-Object -First 1
$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)))
foreach ($w in $wins) {
    if ($w.Current.ProcessId -eq $p.Id -and $w.Current.Name.Length -gt 0) {
        $wp = $w.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
        if ($wp.Current.WindowVisualState -ne [System.Windows.Automation.WindowVisualState]::Normal) {
            $wp.SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Normal)
            Write-Output 'restored'
        } else { Write-Output ('already normal: ' + $w.Current.BoundingRectangle) }
    }
}
Start-Sleep -Seconds 1
