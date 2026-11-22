param(
    [string]$ProcessName = "HUB.Desktop",
    [Parameter(Mandatory=$true)][string]$Name
)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$proc = Get-Process $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Output "no window"; exit 1 }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
$btns = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Button)))
foreach ($b in $btns) {
    if ($b.Current.Name -like "*$Name*") {
        $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        Write-Output "clicked: $($b.Current.Name)"
        exit 0
    }
}
Write-Output "not found"
