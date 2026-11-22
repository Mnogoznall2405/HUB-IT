param([double]$X, [double]$Y, [double]$YMax, [double]$XMax = 10000)
Add-Type -AssemblyName UIAutomationClient
$p = Get-Process HUB.Desktop | Select-Object -First 1
$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)))
$main = $null
foreach ($el in $wins) { if ($el.Current.BoundingRectangle.Width -gt 500 -and $el.Current.Name.Length -gt 0) { $main = $el } }
$all = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button) {
        $r = $e.Current.BoundingRectangle
        if ([Math]::Abs($r.X - $X) -lt 25 -and $r.X -lt $XMax -and $r.Y -gt $Y -and $r.Y -lt $YMax) {
            Write-Output ('invoke: ' + $e.Current.Name + ' x=' + [int]$r.X + ' y=' + [int]$r.Y)
            $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        }
    }
}
