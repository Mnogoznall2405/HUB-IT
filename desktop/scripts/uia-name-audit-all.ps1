Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process HUB.Desktop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Output 'no process'; exit 1 }
$pidCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$roots = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $pidCond)
$interactive = @('ControlType.Button','ControlType.Edit','ControlType.CheckBox','ControlType.RadioButton','ControlType.ComboBox','ControlType.List','ControlType.ListItem','ControlType.MenuItem','ControlType.TabItem','ControlType.Hyperlink','ControlType.Slider','ControlType.Spinner','ControlType.TreeItem','ControlType.DataItem','ControlType.Group')
$bad = 0; $scanned = 0
foreach ($r in $roots) {
    $all = $r.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $scanned += $all.Count
    foreach ($e in $all) {
        $ct = $e.Current.ControlType.ProgrammaticName
        if ($interactive -notcontains $ct) { continue }
        if ($e.Current.IsOffscreen) { continue }
        $n = $e.Current.Name
        $rc = $e.Current.BoundingRectangle
        if ($rc.Width -le 0) { continue }
        $cls = ''
        try { $cls = $e.Current.ClassName } catch {}
        if ($cls -eq 'RepeatButton') { continue }
        if ([string]::IsNullOrWhiteSpace($n)) {
            $bad++
            Write-Output ("EMPTY | $ct | cls=$cls | x=" + [int]$rc.X + ' y=' + [int]$rc.Y + ' | aid=' + $e.Current.AutomationId)
        } elseif ($n -match 'ViewModel|Hub\.Desktop|System\.') {
            $bad++
            Write-Output ("TYPENAME | $ct | $n | cls=$cls")
        }
    }
}
Write-Output "windows: $($roots.Count) scanned: $scanned bad: $bad"
