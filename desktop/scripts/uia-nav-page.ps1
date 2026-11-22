param([Parameter(Mandatory = $true)][string]$PageName)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
. $PSScriptRoot\_uia-root.ps1
$root = Get-HubRoot
if (-not $root) { Write-Output 'no window'; exit 1 }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::RadioButton -and $e.Current.Name -like $PageName) {
        try {
            $e.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
            Write-Output ("page selected: " + $e.Current.Name)
        } catch { Write-Output "select failed: $_" }
        exit 0
    }
}
Write-Output "page not found: $PageName"
exit 1
