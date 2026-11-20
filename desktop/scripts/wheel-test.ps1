param(
    [double]$X = 350,
    [double]$Y = 420,
    [int]$Delta = -480
)
# Реальная прокрутка колесом над списком диалогов: Win32 mouse_event MOUSEEVENTF_WHEEL
# + UIA ScrollPattern внешнего скроллера колонки для замера VerticalScrollPercent.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WheelHelper {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int data, IntPtr extra);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    public const int WHEEL = 0x0800;
}
'@

$proc = Get-Process HUB.Desktop -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Output "no window"; exit 1 }

$root = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)

# Точка над списком диалогов — по координатам элемента «Список диалогов».
$dialogList = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::NameProperty, "Список диалогов"))
if (-not $dialogList) { Write-Output "dialog list not found"; exit 1 }
$bounds = $dialogList.Current.BoundingRectangle
$px = [int]($bounds.Left + 40)
$py = [int]($bounds.Top + [Math]::Min($Y, $bounds.Height - 40))

# Наружный скроллер колонки — ScrollPattern над ListBox (первый ScrollPattern-предок уровня Pane/Custom).
$scroller = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::IsScrollPatternAvailableProperty, $true))
if (-not $scroller) { Write-Output "no scroll pattern"; exit 1 }
$sp = $scroller.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
Write-Output ("before: vpercent={0:N1} vsize={1:N2} viewable={2:N0}" -f $sp.Current.VerticalScrollPercent, $sp.Current.VerticalViewSize, $sp.Current.VerticallyScrollable)

[WheelHelper]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
[WheelHelper]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 500
[WheelHelper]::SetCursorPos($px, $py) | Out-Null
Start-Sleep -Milliseconds 300
[WheelHelper]::mouse_event([WheelHelper]::WHEEL, 0, 0, $Delta, [IntPtr]::Zero)
Start-Sleep -Milliseconds 800

$sp2 = $scroller.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
Write-Output ("after:  vpercent={0:N1}" -f $sp2.Current.VerticalScrollPercent)
if ([Math]::Abs($sp2.Current.VerticalScrollPercent - $sp.Current.VerticalScrollPercent) -gt 0.1) {
    Write-Output "WHEEL OK"
} else {
    Write-Output "WHEEL NO-EFFECT"
}
