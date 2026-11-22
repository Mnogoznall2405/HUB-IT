Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
# Главное окно = самое большое окно процесса. MainWindowHandle ненадёжен:
# WPF-Popup (осиротевшие дропдауны/контекстные меню) может его перехватить.
function Get-HubRoot {
    $p = Get-Process HUB.Desktop | Select-Object -First 1
    if (-not $p) { return $null }
    $pidCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
    $wins = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $pidCond)
    $root = $null; $best = 0
    foreach ($w in $wins) {
        $r = $w.Current.BoundingRectangle
        if ($r.Width * $r.Height -gt $best) { $best = $r.Width * $r.Height; $root = $w }
    }
    return $root
}
