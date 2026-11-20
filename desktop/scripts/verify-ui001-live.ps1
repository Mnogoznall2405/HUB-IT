param(
    [string]$OutDir = "ui-review\screenshots\after"
)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -AssemblyName System.Drawing

$src = @"
using System;
using System.Runtime.InteropServices;
public static class WinUI001 {
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int w, int h, bool repaint);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
Add-Type -TypeDefinition $src -ReferencedAssemblies System.Drawing

$proc = Get-Process HUB.Desktop -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Output "no window"; exit 1 }
[WinUI001]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
[WinUI001]::MoveWindow($proc.MainWindowHandle, 40, 40, 1280, 720, $true) | Out-Null
[WinUI001]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 1500

$root = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)

function Get-DialogList {
    $lists = $root.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::List)))
    foreach ($candidate in $lists) {
        if ($candidate.Current.Name -eq "Список диалогов") { return $candidate }
    }
    foreach ($candidate in $lists) {
        if ($candidate.Current.ClassName -eq "ListBox") { return $candidate }
    }
    return $null
}

function Capture([string]$name) {
    $r = New-Object WinUI001+RECT
    [WinUI001]::GetWindowRect($proc.MainWindowHandle, [ref]$r) | Out-Null
    $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $hdc = $g.GetHdc()
    # PW_RENDERFULLCONTENT (0x2) — снимает и D3D-содержимое WPF.
    [WinUI001]::PrintWindow($proc.MainWindowHandle, $hdc, 2) | Out-Null
    $g.ReleaseHdc($hdc)
    $path = (Resolve-Path .).Path + "\" + $OutDir + "\" + $name
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Output "saved ${w}x${h} -> $name"
}

function Select-Row([System.Windows.Automation.AutomationElement]$list, [int]$i) {
    $items = $list.FindAll(
        [System.Windows.Automation.TreeScope]::Children,
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::ListItem)))
    if ($items.Count -le $i) { return $false }
    try {
        $pattern = $items[$i].GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
        $pattern.Select() | Out-Null
        return $true
    } catch { return $false }
}

function Click-FolderTab([string]$titlePrefix) {
    $buttons = $root.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Button)))
    foreach ($b in $buttons) {
        if ($b.Current.Name -like "$titlePrefix*") {
            $p = $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
            if ($null -ne $p) { $p.Invoke(); return $true }
        }
    }
    return $false
}

$list = Get-DialogList
if (-not $list) { Write-Output "dialog list not found"; exit 1 }
$count = $list.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::ListItem))).Count
Write-Output ("rows: " + $count)

# 1) Личный диалог — вкладка «Личные» гарантирует тип; первая строка выбрана,
#    соседние невыделенные рядом в кадре.
if (Click-FolderTab "Папка Личные") {
    Start-Sleep -Milliseconds 2500
    $listP = Get-DialogList
    if (Select-Row $listP 0) { Start-Sleep -Milliseconds 2500; Capture "UI-001-live-personal-1280x720.png" }
    else { Write-Output "no personal rows" }
} else { Write-Output "personal tab not found" }

# 2) Групповой диалог — вкладка «Беседы».
if (Click-FolderTab "Папка Беседы") {
    Start-Sleep -Milliseconds 2500
    $listG = Get-DialogList
    if (Select-Row $listG 0) { Start-Sleep -Milliseconds 2500; Capture "UI-001-live-group-1280x720.png" }
    else { Write-Output "no group rows" }
} else { Write-Output "groups tab not found" }

Write-Output "done"
