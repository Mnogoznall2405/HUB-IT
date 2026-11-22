param([Parameter(Mandatory = $true)][string]$ItemName)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
. $PSScriptRoot\_uia-root.ps1
$root = Get-HubRoot
if (-not $root) { Write-Output 'no window'; exit 1 }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::ListItem -and $e.Current.Name -eq $ItemName) {
        $r = $e.Current.BoundingRectangle
        $x = [int]($r.X + $r.Width / 2); $y = [int]($r.Y + $r.Height / 2)
        Write-Output ("item at " + $x + "," + $y)
        & powershell -File $PSScriptRoot\uia-click-xy.ps1 -X $x -Y $y -Right
        exit 0
    }
}
Write-Output "item not found: $ItemName"
exit 1
