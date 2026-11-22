param([string]$ListName = '')
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
. $PSScriptRoot\_uia-root.ps1
$root = Get-HubRoot
if (-not $root) { Write-Output 'no window'; exit 1 }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
    $ct = $e.Current.ControlType.ProgrammaticName
    if ($ct -eq 'ControlType.GroupItem' -or ($ct -eq 'ControlType.CheckBox' -and $e.Current.Name -ne '')) {
        $r = $e.Current.BoundingRectangle
        Write-Output ($ct + ' | ' + $e.Current.Name.Substring(0, [Math]::Min(70, $e.Current.Name.Length)) + ' | x=' + [int]$r.X + ' w=' + [int]$r.Width)
    }
}
