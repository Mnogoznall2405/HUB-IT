param([string]$Match = "Папка")
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process HUB.Desktop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Output "no window"; exit 1 }
$r = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$all = $r.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
Write-Output ("elements: " + $all.Count)
foreach ($e in $all) {
    $n = $e.Current.Name
    if ($n -match $Match) {
        Write-Output ($e.Current.ControlType.ProgrammaticName + " | " + $e.Current.ClassName + " | " + $n)
    }
}
