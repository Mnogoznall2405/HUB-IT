Add-Type -AssemblyName UIAutomationClient
$p = Get-Process HUB.Desktop | Select-Object -First 1
$root = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)))
$main = $null
foreach ($w in $wins) { if ($w.Current.BoundingRectangle.Width -gt 900) { $main = $w } }
if ($null -eq $main) { Write-Output 'no main'; exit }
$all = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$found = 0
foreach ($e in $all) {
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button) {
        $r = $e.Current.BoundingRectangle
        if ($r.Width -le 30 -and $r.X -gt 880 -and -not $e.Current.IsOffscreen) {
            Write-Output ("btn x=" + [int]$r.X + " y=" + [int]$r.Y + " w=" + [int]$r.Width + " h=" + [int]$r.Height)
            $found++
            if ($found -ge 5) { break }
        }
    }
}
Write-Output ("found=" + $found)
