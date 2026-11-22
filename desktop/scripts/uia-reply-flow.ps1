Add-Type -AssemblyName UIAutomationClient
$p = Get-Process HUB.Desktop | Select-Object -First 1
$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)))
$main = $null
foreach ($w in $wins) { if ($w.Current.BoundingRectangle.Width -gt 900) { $main = $w } }
$all = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)

# 1. first ListItem whose name contains ':' (message rows), select it
$liType = [System.Windows.Automation.ControlType]::ListItem
foreach ($e in $all) {
    if ($e.Current.ControlType -eq $liType -and $e.Current.Name.Contains(':') -and -not $e.Current.IsOffscreen) {
        $sel = $e.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
        $sel.Select()
        Write-Output ('selected: ' + $e.Current.Name.Substring(0, [Math]::Min(70, $e.Current.Name.Length)))
        break
    }
}
Start-Sleep -Seconds 2

# 2. reply button: starts with O + t (U+041E U+0442), inside reading pane
$all = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button) {
        $r = $e.Current.BoundingRectangle
        $n = $e.Current.Name
        if ($n.Length -gt 1 -and $n[0] -eq [char]0x041E -and $n[1] -eq [char]0x0442 -and $r.X -gt 960 -and $r.Y -gt 200 -and $r.Y -lt 400) {
            Write-Output ('reply btn: ' + $n + ' x=' + [int]$r.X + ' y=' + [int]$r.Y)
            $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
            break
        }
    }
}
Start-Sleep -Seconds 3

# 3. dump composer fields
$all = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit) {
        $v = ''
        try { $v = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value } catch {}
        Write-Output ('edit: ' + $e.Current.Name + ' = ' + $v.Substring(0, [Math]::Min(70, $v.Length)))
    }
}
