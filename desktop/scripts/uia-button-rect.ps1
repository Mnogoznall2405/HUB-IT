param([Parameter(Mandatory = $true)][string]$NameLike)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process HUB.Desktop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Output "no window"; exit 1 }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$bs = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Button)))
foreach ($b in $bs) {
    if ($b.Current.Name -like $NameLike) {
        $r = $b.Current.BoundingRectangle
        Write-Output ($b.Current.Name + ' | x=' + [int]$r.X + ' y=' + [int]$r.Y + ' w=' + [int]$r.Width + ' h=' + [int]$r.Height)
    }
}
