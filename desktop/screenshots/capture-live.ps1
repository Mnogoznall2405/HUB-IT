param(
    [string]$ProcessName = 'HUB.Desktop',
    [string]$Out = 'desktop\screenshots\live\live-capture.png'
)
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
namespace W {
    public static class U32 {
        [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool PrintWindow(System.IntPtr hwnd, System.IntPtr hdcBlt, uint nFlags);
        [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr hWnd, out RECT lpRect);
        public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    }
}
'@
$p = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { 'no process'; exit 1 }
$r = New-Object 'W.U32+RECT'
[W.U32]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
if ($w -le 0 -or $h -le 0) { "bad rect $w x $h"; exit 1 }
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
[W.U32]::PrintWindow($p.MainWindowHandle, $hdc, 2) | Out-Null
$g.ReleaseHdc($hdc); $g.Dispose()
$bmp.Save($Out)
$bmp.Dispose()
"saved $Out $w x $h"
