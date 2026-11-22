param(
    [string]$ProcessName = "HUB.Desktop",
    [Parameter(Mandatory = $true)][string]$Out
)
$src = @'
using System;
using System.Runtime.InteropServices;
public struct HubWindowRect { public int Left, Top, Right, Bottom; }
public static class WinRect {
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out HubWindowRect r);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
}
'@
Add-Type -TypeDefinition $src
Add-Type -AssemblyName System.Drawing
$p = Get-Process $ProcessName | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Output "no window"; exit 1 }
[WinRect]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
[WinRect]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
[WinRect]::BringWindowToTop($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 700
$r = New-Object HubWindowRect
[WinRect]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
$bmp = [System.Drawing.Bitmap]::new($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, [System.Drawing.Size]::new($w, $h))
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "saved ${w}x${h} -> $Out"
