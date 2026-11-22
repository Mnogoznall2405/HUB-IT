param([Parameter(Mandatory = $true)][int]$X, [Parameter(Mandatory = $true)][int]$Y, [switch]$Right)
$src = @'
using System;
using System.Runtime.InteropServices;
public static class RealMouseXY {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, IntPtr i);
}
'@
Add-Type -TypeDefinition $src
[RealMouseXY]::SetCursorPos($X, $Y) | Out-Null
Start-Sleep -Milliseconds 150
if ($Right) {
    [RealMouseXY]::mouse_event(0x0008, 0, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 60
    [RealMouseXY]::mouse_event(0x0010, 0, 0, 0, [IntPtr]::Zero)
    Write-Output "right-clicked at $X,$Y"
} else {
    [RealMouseXY]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 60
    [RealMouseXY]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
    Write-Output "clicked at $X,$Y"
}
