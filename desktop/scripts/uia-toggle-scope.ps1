Add-Type -AssemblyName UIAutomationClient
$p = Get-Process HUB.Desktop | Select-Object -First 1
$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)))
$main = $null
foreach ($el in $wins) { if ($el.Current.BoundingRectangle.Width -gt 500 -and $el.Current.Name.Length -gt 0) { $main = $el } }
$all = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $e.Current.BoundingRectangle.X -gt 1150 -and $e.Current.BoundingRectangle.Y -lt 200 -and -not $e.Current.IsOffscreen) {
        try {
            $tp = $e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
            Write-Output ('toggle: ' + $e.Current.Name + ' state=' + $tp.Current.ToggleState)
            $tp.Toggle()
            Write-Output 'toggled'
        } catch { Write-Output ('skip: ' + $e.Current.Name) }
    }
}
Start-Sleep -Seconds 3
$all = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text -and $e.Current.Name.StartsWith([char]0x0422)) {
        $r = $e.Current.BoundingRectangle
        if ($r.X -lt 800 -and $r.Y -gt 150 -and $r.Y -lt 300) { Write-Output ('header: ' + $e.Current.Name) }
    }
}
