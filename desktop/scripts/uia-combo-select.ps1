param([string]$ComboName = '', [int]$ItemIndex = 0)
. $PSScriptRoot\_uia-root.ps1
$root = Get-HubRoot
if (-not $root) { Write-Output 'no window'; exit 1 }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
    if ($e.Current.ControlType -ne [System.Windows.Automation.ControlType]::ComboBox) { continue }
    if ($ComboName -and $e.Current.Name -ne $ComboName) { continue }
    try {
        $ec = $e.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
        $ec.Expand()
        Start-Sleep 1
        $items = $e.FindAll([System.Windows.Automation.TreeScope]::Descendants,
            (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)))
        Write-Output "combo [$($e.Current.Name)] items: $($items.Count)"
        $i = 0
        foreach ($it in $items) {
            Write-Output ("  #$i " + $it.Current.Name.Substring(0, [Math]::Min(60, $it.Current.Name.Length)))
            if ($i -eq $ItemIndex) {
                try { $it.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select(); Write-Output "  -> selected" } catch { Write-Output "  select failed: $_" }
            }
            $i++
        }
    } catch { Write-Output "combo error: $_" }
    break
}
