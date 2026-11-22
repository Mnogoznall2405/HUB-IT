Add-Type -AssemblyName UIAutomationClient
$p = Get-Process HUB.Desktop | Select-Object -First 1
$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)))
$main = $null
foreach ($w in $wins) { if ($w.Current.BoundingRectangle.Width -gt 900) { $main = $w } }
$all = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$seen = @{}
foreach ($e in $all) {
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and -not $e.Current.IsOffscreen) {
        $r = $e.Current.BoundingRectangle
        if ($r.X -gt 400 -and $r.X -lt 1000 -and $r.Width -le 30) {
            $key = $e.Current.Name
            if (-not $seen.ContainsKey($key)) {
                $seen[$key] = $true
                Write-Output ("'" + $e.Current.Name + "' x=" + [int]$r.X + " y=" + [int]$r.Y + " w=" + [int]$r.Width)
            }
        }
    }
}
