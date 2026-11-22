Add-Type -AssemblyName UIAutomationClient
$p = Get-Process HUB.Desktop | Select-Object -First 1
$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)))
$main = $null
foreach ($w in $wins) { if ($w.Current.BoundingRectangle.Width -gt 900) { $main = $w } }
$winR = $main.Current.BoundingRectangle
$all = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
Write-Output '=== TOP BAND ==='
foreach ($e in $all) {
    $r = $e.Current.BoundingRectangle
    if ($r.Y -lt $winR.Y + 120 -and $r.Y -gt $winR.Y + 60 -and -not $e.Current.IsOffscreen -and $e.Current.Name.Length -gt 0) {
        Write-Output ($e.Current.ControlType.ProgrammaticName + ' | ' + $e.Current.Name.Substring(0, [Math]::Min(50, $e.Current.Name.Length)) + ' | x=' + [int]$r.X + ' w=' + [int]$r.Width)
    }
}
Write-Output '=== BOTTOM BAND ==='
foreach ($e in $all) {
    $r = $e.Current.BoundingRectangle
    if ($r.Y -gt $winR.Y + $winR.Height - 60 -and -not $e.Current.IsOffscreen -and $e.Current.Name.Length -gt 0 -and $r.Width -lt 3000) {
        Write-Output ($e.Current.ControlType.ProgrammaticName + ' | ' + $e.Current.Name.Substring(0, [Math]::Min(60, $e.Current.Name.Length)) + ' | x=' + [int]$r.X + ' w=' + [int]$r.Width)
    }
}
