Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process HUB.Desktop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Output "no window"; exit 1 }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
    if ($e.Current.ClassName -eq 'Chrome_WidgetWin_1') {
        $doc = $e.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        Write-Output ('webview children: ' + $doc.Count)
        $i = 0
        foreach ($d in $doc) {
            if ($i++ -ge 30) { break }
            $name = ($d.Current.Name -replace "`n", ' ')
            if ($name.Length -gt 70) { $name = $name.Substring(0, 70) }
            Write-Output ($d.Current.ControlType.ProgrammaticName + ' | ' + $d.Current.ClassName + ' | ' + $name)
        }
    }
}
