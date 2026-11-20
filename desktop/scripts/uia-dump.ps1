Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$proc = Get-Process HUB.Desktop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Output "no window"; exit 1 }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
Write-Output ("elements: " + $all.Count)
foreach ($e in $all) {
    $ct = $e.Current.ControlType.ProgrammaticName
    if ($ct -match 'List|Window|Pane|Edit') {
        Write-Output ($ct + ' | ' + $e.Current.Name + ' | ' + $e.Current.ClassName)
    }
}
