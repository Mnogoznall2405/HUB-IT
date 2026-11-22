param([int]$ItemIndex = 0)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process HUB.Desktop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Output 'no process'; exit 1 }
$pidCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
$roots = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $pidCond)
foreach ($r in $roots) {
    if ($r.Current.ProcessId -ne $p.Id) { continue }
    $all = $r.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $i = 0
    foreach ($e in $all) {
        if ($e.Current.ControlType -ne [System.Windows.Automation.ControlType]::ListItem) { continue }
        if ($e.Current.IsOffscreen) { continue }
        $n = $e.Current.Name
        Write-Output ("#$i " + $n.Substring(0, [Math]::Min(60, $n.Length)) + " | win=" + $r.Current.Name)
        if ($i -eq $ItemIndex) {
            try { $e.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select(); Write-Output "-> selected" } catch { Write-Output "select failed: $_" }
        }
        $i++
    }
}
