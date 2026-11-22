$src = @'
using System;
using System.Runtime.InteropServices;
public static class WinFg {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, IntPtr i);
}
'@
Add-Type -TypeDefinition $src
Add-Type -AssemblyName UIAutomationClient

$p = Get-Process HUB.Desktop | Select-Object -First 1
$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)))
$main = $null
foreach ($w in $wins) { if ($w.Current.Name -match 'HUB Desktop') { $main = $w } }
if ($null -eq $main) { Write-Output 'main window not found'; exit 1 }

$hwnd = [IntPtr]$main.Current.NativeWindowHandle
[WinFg]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 400
$r = $main.Current.BoundingRectangle
[WinFg]::SetCursorPos([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2)) | Out-Null
Start-Sleep -Milliseconds 150
[WinFg]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 60
[WinFg]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Seconds 1

$wins = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)))
Write-Output ("windows: " + $wins.Count)
foreach ($w in $wins) { Write-Output ($w.Current.Name + ' | ' + $w.Current.BoundingRectangle) }
