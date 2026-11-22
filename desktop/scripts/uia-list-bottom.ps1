Add-Type -AssemblyName UIAutomationClient
$p = Get-Process HUB.Desktop | Select-Object -First 1
$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)))
$main = $null
foreach ($w in $wins) { if ($w.Current.BoundingRectangle.Width -gt 900) { $main = $w } }
$all = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$list = $null
foreach ($e in $all) {
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::List) {
        $items = $e.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)))
        if ($items.Count -gt 5) { $list = $e }
    }
}
try {
    $sp = $list.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
    Write-Output ('vert pct=' + [int]$sp.Current.VerticalScrollPercent + ' viewSize=' + [int]$sp.Current.VerticalViewSize)
    $sp.SetScrollPercent([System.Windows.Automation.ScrollPattern]::NoScroll, 100)
    Start-Sleep -Milliseconds 800
    Write-Output ('after: pct=' + [int]$sp.Current.VerticalScrollPercent)
} catch { Write-Output ('no scroll: ' + $_.Exception.Message) }

$all = $main.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
    $n = $e.Current.Name
    if ($n.Contains([char]0x0435) -and ($n -match 'ещ|Ещ' -or $n -match 'загруз|Загруз')) {
        $r = $e.Current.BoundingRectangle
        Write-Output ($e.Current.ControlType.ProgrammaticName + ' | ' + $n.Substring(0, [Math]::Min(50, $n.Length)) + ' | x=' + [int]$r.X + ' y=' + [int]$r.Y + ' off=' + $e.Current.IsOffscreen + ' en=' + $e.Current.IsEnabled)
    }
}
