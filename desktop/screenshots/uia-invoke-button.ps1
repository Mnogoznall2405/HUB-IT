param(
    [Parameter(Mandatory=$true)][string]$Name,
    [int]$ProcessId = 0,
    [int]$TimeoutMs = 8000
)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$auto = [System.Windows.Automation.AutomationElement]
$root = $auto::RootElement
$win = $null
if ($ProcessId -gt 0) {
    $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)
    $win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
} else {
    $titleCond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty, "HUB Desktop")
    $win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $titleCond)
}
if ($null -eq $win) { Write-Output "window not found"; exit 1 }
$deadline = (Get-Date).AddMilliseconds($TimeoutMs)
do {
    $btnCond = New-Object System.Windows.Automation.AndCondition(
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Button)),
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty, $Name)))
    $btn = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $btnCond)
    if ($null -ne $btn) { break }
    Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)
if ($null -eq $btn) {
    Write-Output "button '$Name' not found; buttons present:"
    $all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Button)))
    foreach ($b in $all) { Write-Output ("  - " + $b.Current.Name) }
    exit 2
}
$btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
Write-Output "invoked: $Name"
