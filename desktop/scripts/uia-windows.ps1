Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process HUB.Desktop | Select-Object -First 1
if (-not $p) { Write-Output 'no process'; exit 1 }
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$roots = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
Write-Output "windows: $($roots.Count)"
foreach ($w in $roots) {
    $r = $w.Current.BoundingRectangle
    $nm = $w.Current.Name
    Write-Output ($nm + ' | ' + $w.Current.ControlType.ProgrammaticName + ' | ' + [int]$r.X + ',' + [int]$r.Y + ' ' + [int]$r.Width + 'x' + [int]$r.Height + ' | hwnd=' + $w.Current.NativeWindowHandle + ' off=' + $w.Current.IsOffscreen)
}
