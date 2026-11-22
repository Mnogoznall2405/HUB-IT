param([int]$Width = 700, [int]$Height = 760)
$src = @'
using System;
using System.Runtime.InteropServices;
public static class WinPos {
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr i, int x, int y, int cx, int cy, uint f);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
}
'@
Add-Type -TypeDefinition $src
$p = Get-Process HUB.Desktop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
[WinPos]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
[WinPos]::SetWindowPos($p.MainWindowHandle, [IntPtr]::Zero, 60, 40, $Width, $Height, 0) | Out-Null
Start-Sleep 3
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
    $n = $e.Current.Name; $r = $e.Current.BoundingRectangle
    if ($r.Width -lt 3000 -and ($n -match 'Список писем|Развернуть|списку|Входящие|Выберите письмо|Показать след|писем|Назад')) {
        Write-Output ($e.Current.ControlType.ProgrammaticName + ' | ' + $n.Substring(0, [Math]::Min(45, $n.Length)) + ' | x=' + [int]$r.X + ' w=' + [int]$r.Width + ' off=' + $e.Current.IsOffscreen)
    }
}
