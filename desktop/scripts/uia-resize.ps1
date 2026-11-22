param([double]$NewW, [double]$NewH)
$src = @'
using System;
using System.Runtime.InteropServices;
public static class WinMove2 {
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool repaint);
}
'@
Add-Type -TypeDefinition $src
Add-Type -AssemblyName UIAutomationClient
$p = Get-Process HUB.Desktop | Select-Object -First 1
$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)))
$main = $null
foreach ($el in $wins) { if ($el.Current.BoundingRectangle.Width -gt 500) { $main = $el } }
$r = $main.Current.BoundingRectangle
[WinMove2]::MoveWindow([IntPtr]$main.Current.NativeWindowHandle, [int]$r.X, [int]$r.Y, [int]$NewW, [int]$NewH, $true) | Out-Null
Start-Sleep -Seconds 2
$main2 = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$main.Current.NativeWindowHandle)
Write-Output ('now: ' + $main2.Current.BoundingRectangle)
