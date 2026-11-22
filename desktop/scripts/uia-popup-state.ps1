Add-Type -AssemblyName UIAutomationClient
$p = Get-Process HUB.Desktop | Select-Object -First 1
$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)))
foreach ($w in $wins) {
    $r = $w.Current.BoundingRectangle
    $line = "win hwnd=" + $w.Current.NativeWindowHandle + " name='" + $w.Current.Name + "' rect=" + $r + " offscreen=" + $w.Current.IsOffscreen
    try {
        $wp = $w.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
        $line += " state=" + $wp.Current.WindowVisualState + " canClose=" + $wp.Current.CanClose
    } catch { $line += " noWindowPattern" }
    Write-Output $line
}
