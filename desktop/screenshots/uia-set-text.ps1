param(
    [string]$AutomationId,
    [string]$Name,
    [Parameter(Mandatory=$true)][string]$Text,
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
    $matchValue = if ($AutomationId) { $AutomationId } else { $Name }
    $matchProp = if ($AutomationId) {
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty
    } else {
        [System.Windows.Automation.AutomationElement]::NameProperty
    }
    $editCond = New-Object System.Windows.Automation.AndCondition(
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Edit)),
        (New-Object System.Windows.Automation.PropertyCondition($matchProp, $matchValue)))
    $edit = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editCond)
    if ($null -ne $edit) { break }
    Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)
if ($null -eq $edit) {
    Write-Output "edit '$matchValue' not found; edits present:"
    $all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Edit)))
    foreach ($e in $all) { Write-Output ("  - " + $e.Current.AutomationId + " | " + $e.Current.Name) }
    exit 2
}
$edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($Text)
Write-Output "set '$matchValue' = '$Text'"
