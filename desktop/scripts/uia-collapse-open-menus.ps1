Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process HUB.Desktop | Select-Object -First 1
$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children,
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)))
foreach ($w in $wins) {
    if ($w.Current.Name -like 'HUB Desktop*') { continue }
    $menus = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Menu)))
    foreach ($m in $menus) {
        try {
            $ec = $m.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
            $ec.Collapse()
            Write-Output 'menu collapsed'
        } catch {
            try { $m.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close(); Write-Output 'window closed' } catch { Write-Output "no close pattern: $_" }
        }
    }
}
Start-Sleep -Milliseconds 600
$wins2 = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children,
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)))
Write-Output ('windows now: ' + $wins2.Count)
