param([Parameter(Mandatory = $true)][string]$ItemName)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process HUB.Desktop | Select-Object -First 1
$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children,
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)))
$target = $null
foreach ($w in $wins) {
    $mis = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::MenuItem)))
    foreach ($mi in $mis) {
        if ($mi.Current.Name -eq $ItemName) { $target = $mi; break }
    }
    if ($target) { break }
}
if (-not $target) { Write-Output "menuitem not found: $ItemName"; exit 1 }
try { $target.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand() } catch { Write-Output "expand failed: $_" }
Start-Sleep -Milliseconds 900
foreach ($w in $wins) {
    $mis = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::MenuItem)))
    foreach ($mi in $mis) {
        $r = $mi.Current.BoundingRectangle
        Write-Output ('MenuItem | ' + $mi.Current.Name + ' | en=' + $mi.Current.IsEnabled + ' | x=' + [int]$r.X + ' off=' + $mi.Current.IsOffscreen)
    }
}
