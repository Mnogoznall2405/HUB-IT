param(
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$ProcessName = "HUB.Desktop"
)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$src = @'
using System;
using System.Runtime.InteropServices;
public static class RealMouse {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, IntPtr i);
}
'@
Add-Type -TypeDefinition $src
$proc = Get-Process $ProcessName | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Output "no window"; exit 1 }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
    if ($e.Current.Name -eq $Name -and -not $e.Current.IsOffscreen) {
        $r = $e.Current.BoundingRectangle
        $cx = [int]($r.X + $r.Width / 2); $cy = [int]($r.Y + $r.Height / 2)
        [RealMouse]::SetCursorPos($cx, $cy) | Out-Null
        Start-Sleep -Milliseconds 200
        [RealMouse]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 60
        [RealMouse]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
        Write-Output "clicked $Name at $cx,$cy"
        exit 0
    }
}
Write-Output "not found: $Name"
exit 1
