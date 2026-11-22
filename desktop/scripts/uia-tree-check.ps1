Add-Type -AssemblyName UIAutomationClient
$p = Get-Process HUB.Desktop | Select-Object -First 1
$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)))
$main = $null
foreach ($w in $wins) { if ($w.Current.BoundingRectangle.Width -gt 900) { $main = $w } }
$all = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $e.Current.Name.StartsWith([char]0x0420) -and $e.Current.Name.Length -gt 30 -and -not $e.Current.IsOffscreen) {
        $r = $e.Current.BoundingRectangle
        Write-Output ('chevron: ' + $e.Current.Name + ' x=' + [int]$r.X + ' y=' + [int]$r.Y)
    }
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::ListItem -and $e.Current.BoundingRectangle.X -lt 500 -and -not $e.Current.IsOffscreen) {
        $r = $e.Current.BoundingRectangle
        Write-Output ('folder: ' + $e.Current.Name.Substring(0, [Math]::Min(40, $e.Current.Name.Length)) + ' | x=' + [int]$r.X + ' y=' + [int]$r.Y)
    }
}
