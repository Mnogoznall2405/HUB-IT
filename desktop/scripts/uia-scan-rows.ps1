param([int]$Max = 40)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process HUB.Desktop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Output "no window"; exit 1 }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)

# Сначала вкладка «Все».
$buttons = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Button)))
foreach ($b in $buttons) {
    if ($b.Current.Name -like "Папка Все*") {
        $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        Write-Output "clicked All"
        break
    }
}
Start-Sleep -Milliseconds 2500

$list = $null
for ($try = 0; $try -lt 15 -and -not $list; $try++) {
    $lists = $root.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::List)))
    foreach ($c in $lists) { if ($c.Current.Name -eq "Список диалогов") { $list = $c; break } }
    if (-not $list) { Start-Sleep -Milliseconds 800 }
}
if (-not $list) { Write-Output "no list"; exit 1 }

$items = $list.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::ListItem)))
Write-Output ("rows: " + $items.Count)
for ($i = 0; $i -lt [Math]::Min($items.Count, $Max); $i++) {
    # Тексты внутри строки — заголовок и подзаголовок («Группа · …» у групп).
    $texts = $items[$i].FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Text)))
    $row = @()
    foreach ($t in $texts) { $row += $t.Current.Name }
    Write-Output ("$i :: " + ($row -join " | "))
}
