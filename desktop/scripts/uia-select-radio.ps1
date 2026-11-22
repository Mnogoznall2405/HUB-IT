param([Parameter(Mandatory = $true)][string]$NameLike)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
. $PSScriptRoot\_uia-root.ps1
$root = Get-HubRoot
if (-not $root) { Write-Output 'no window'; exit 1 }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::RadioButton -and $e.Current.Name -like $NameLike) {
        try {
            $e.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
            Write-Output ("radio selected: " + $e.Current.Name)
        } catch { Write-Output "select failed: $_" }
        exit 0
    }
}
Write-Output "radio not found: $NameLike"
exit 1
