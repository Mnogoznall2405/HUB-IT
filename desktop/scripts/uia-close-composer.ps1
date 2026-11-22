Add-Type -AssemblyName UIAutomationClient
$p = Get-Process HUB.Desktop | Select-Object -First 1
$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)))
$main = $null
foreach ($w in $wins) { if ($w.Current.BoundingRectangle.Width -gt 900) { $main = $w } }
$all = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button) {
        $n = $e.Current.Name
        # close composer: name contains Cyrillic Z (U+0417) as first char
        if ($n.Length -gt 0 -and $n[0] -eq [char]0x0417) {
            Write-Output ('closing via: ' + $n)
            $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
            break
        }
    }
}
Start-Sleep -Seconds 1
$all = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$found = $false
foreach ($e in $all) { if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and $e.Current.Name -match 'Re:') { $found = $true } }
Write-Output ('composer still open: ' + $found)
