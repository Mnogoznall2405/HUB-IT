Add-Type -AssemblyName UIAutomationClient
$p = Get-Process HUB.Desktop | Select-Object -First 1
$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)))
$main = $null
foreach ($w in $wins) { if ($w.Current.BoundingRectangle.Width -gt 900) { $main = $w } }
$all = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text -and $e.Current.Name.StartsWith('FW:')) {
        $r = $e.Current.BoundingRectangle
        if ($r.X -gt 950) {
            Write-Output ('name len=' + $e.Current.Name.Length + ' w=' + [int]$r.Width + ' h=' + [int]$r.Height + ' y=' + [int]$r.Y)
            Write-Output ('full: ' + $e.Current.Name)
        }
    }
}
