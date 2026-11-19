param(
    [int]$ProcessId,
    [string]$SearchName = "Поиск по сообщениям диалога",
    [string]$Query = "api",
    [string]$ResultsListName = "Результаты поиска по сообщениям"
)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$auto = [System.Windows.Automation.AutomationElement]
$root = $auto::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)

function Get-Win {
    return $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
}

# 1. Восстановить окно
$win = Get-Win
if ($null -eq $win) { Write-Output "window not found"; exit 1 }
$wp = $win.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
if ($wp.Current.WindowVisualState -ne [System.Windows.Automation.WindowVisualState]::Normal) {
    $wp.SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Normal)
    Start-Sleep -Milliseconds 600
}
Write-Output ("state: " + $wp.Current.WindowVisualState)

# 2. Открыть панель поиска, если закрыта (кнопка в шапке)
$win = Get-Win
$editCond = New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Edit)),
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty, $SearchName)))
$edit = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editCond)
if ($null -eq $edit -or $edit.Current.IsOffscreen) {
    $btnCond = New-Object System.Windows.Automation.AndCondition(
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Button)),
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty, "Поиск по сообщениям")))
    $btn = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $btnCond)
    if ($null -ne $btn) {
        $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        Write-Output "search panel toggled open"
        Start-Sleep -Milliseconds 500
    }
    $win = Get-Win
    $edit = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editCond)
}
if ($null -eq $edit) { Write-Output "search edit not found"; exit 2 }

# 3. Ввести запрос и дождаться результатов
$edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($Query)
Write-Output "query set"
$deadline = (Get-Date).AddSeconds(10)
$list = $null
$items = $null
do {
    Start-Sleep -Milliseconds 500
    $win = Get-Win
    $listCond = New-Object System.Windows.Automation.AndCondition(
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::List)),
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty, $ResultsListName)))
    $list = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $listCond)
    if ($null -ne $list) {
        $itemCond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::ListItem)
        $items = $list.FindAll([System.Windows.Automation.TreeScope]::Children, $itemCond)
        if ($items.Count -gt 0) { break }
    }
} while ((Get-Date) -lt $deadline)
if ($null -eq $list -or $items.Count -eq 0) { Write-Output "no results"; exit 3 }
Write-Output ("results: " + $items.Count)

# 4. Клик по первому результату — кнопка внутри ListItem
$item = $items[0]
$btnCond2 = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button)
$innerBtn = $item.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $btnCond2)
if ($null -ne $innerBtn) {
    $innerBtn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    Write-Output "result invoked"
} else {
    $item.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
    Write-Output "result selected"
}
Start-Sleep -Seconds 2
$win = Get-Win
$wp2 = $win.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
Write-Output ("final state: " + $wp2.Current.WindowVisualState)
