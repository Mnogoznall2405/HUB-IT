param([int]$Row = -1)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process HUB.Desktop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Output "no window"; exit 1 }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)

$nav = $null
$items = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::RadioButton)))
foreach ($b in $items) {
    if ($b.Current.Name -eq "Страница: почта") { $nav = $b; break }
}
if (-not $nav) { Write-Output "nav 'Почта' not found"; exit 1 }
$nav.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
Write-Output "navigated to Почта"

# Ждём заполнения списка писем (реальные данные грузятся асинхронно).
$list = $null
for ($try = 0; $try -lt 20 -and (-not $list -or $list.Count -eq 0); $try++) {
    Start-Sleep -Milliseconds 700
    $lists = $root.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::List)))
    foreach ($c in $lists) {
        if ($c.Current.Name -eq "Список писем") { $list = $c; break }
    }
    if (-not $list) { continue }
    $rows = $list.FindAll(
        [System.Windows.Automation.TreeScope]::Children,
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::ListItem)))
    $count = $rows.Count
    if ($count -gt 0) { break }
}
Write-Output ("rows: " + $count)
if ($Row -ge 0 -and $count -gt $Row) {
    $rows[$Row].GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
    Write-Output ("selected row " + $Row)
    Start-Sleep -Milliseconds 2500
}
