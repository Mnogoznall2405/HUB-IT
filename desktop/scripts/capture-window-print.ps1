param(
    [string]$ProcessName = "HUB.Desktop",
    [string]$Out = "desktop\screenshots\live-native.png"
)
Add-Type -AssemblyName System.Drawing
$src = @"
using System;
using System.Runtime.InteropServices;
public static class W32Print {
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
Add-Type -TypeDefinition $src -ReferencedAssemblies System.Drawing
$proc = Get-Process $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Output "no window"; exit 1 }
[W32Print]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null  # SW_RESTORE
Start-Sleep -Milliseconds 700
$r = New-Object W32Print+RECT
[W32Print]::GetWindowRect($proc.MainWindowHandle, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$dc = $g.GetHdc()
[W32Print]::PrintWindow($proc.MainWindowHandle, $dc, 2) | Out-Null  # PW_RENDERFULLCONTENT
$g.ReleaseHdc($dc)
$bmp.Save((Resolve-Path .).Path + "\" + $Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "saved ${w}x${h} -> $Out"
