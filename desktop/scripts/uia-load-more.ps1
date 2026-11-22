Add-Type -AssemblyName UIAutomationClient
$p = Get-Process HUB.Desktop | Select-Object -First 1
$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)))
$main = $null
foreach ($w in $wins) { if ($w.Current.BoundingRectangle.Width -gt 900) { $main = $w } }
$all = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and -not $e.Current.IsOffscreen) {
        $r = $e.Current.BoundingRectangle
        if ($r.Y -gt 850 -and $r.Width -gt 140 -and $e.Current.Name.Length -gt 25) {
            Write-Output ('invoke: ' + $e.Current.Name)
            $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        }
    }
}
Start-Sleep -Seconds 4
$all = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text) {
        $n = $e.Current.Name
        if ($n.Contains([char]0x0437) -and $n.Length -lt 60 -and $n.Length -gt 10) { Write-Output ('txt: ' + $n) }
    }
}
