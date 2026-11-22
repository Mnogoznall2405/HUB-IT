param([Parameter(Mandatory = $true)][string]$NameLike)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
. $PSScriptRoot\_uia-root.ps1
$root = Get-HubRoot
if (-not $root) { Write-Output 'no window'; exit 1 }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::CheckBox -and $e.Current.Name -like $NameLike) {
        try {
            $t = $e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
            $before = $t.Current.ToggleState
            $t.Toggle()
            Start-Sleep -Milliseconds 800
            Write-Output ("toggled: " + $e.Current.Name + " | " + $before + " -> " + $t.Current.ToggleState)
        } catch { Write-Output "toggle failed: $_" }
        exit 0
    }
}
Write-Output "checkbox not found: $NameLike"
exit 1
