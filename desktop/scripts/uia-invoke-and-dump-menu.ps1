param([Parameter(Mandatory = $true)][string]$ButtonName, [int]$WaitMs = 1200)
. $PSScriptRoot\_uia-root.ps1
$root = Get-HubRoot
if (-not $root) { Write-Output 'no window'; exit 1 }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$btn = $null
foreach ($e in $all) {
    if ($e.Current.Name -eq $ButtonName -and $e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button) { $btn = $e; break }
}
if (-not $btn) { Write-Output "button not found: $ButtonName"; exit 1 }
try { $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() } catch { Write-Output "invoke failed: $_"; exit 1 }
Start-Sleep -Milliseconds $WaitMs
$p = Get-Process HUB.Desktop | Select-Object -First 1
$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children,
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)))
foreach ($w in $wins) {
    $items = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::MenuItem)))
    foreach ($mi in $items) {
        Write-Output ("MenuItem | " + $mi.Current.Name + " | en=" + $mi.Current.IsEnabled)
    }
}
