param(
    [Parameter(Mandatory = $true)][string]$Value,
    [string]$ProcessName = "HUB.Desktop",
    [switch]$Enter
)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$src = @'
using System;
using System.Runtime.InteropServices;
public static class RealKey {
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint f, UIntPtr i);
}
'@
Add-Type -TypeDefinition $src
$proc = Get-Process $ProcessName | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Output "no window"; exit 1 }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
    if ($e.Current.Name -eq $Value -and $e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit) {
        $e.SetFocus()
        Start-Sleep -Milliseconds 200
        if ($Enter) {
            [RealKey]::keybd_event(0x0D, 0, 0, [UIntPtr]::Zero)
            Start-Sleep -Milliseconds 60
            [RealKey]::keybd_event(0x0D, 0, 2, [UIntPtr]::Zero)
            Write-Output "enter sent to $Value"
        }
        exit 0
    }
}
Write-Output "not found: $Value"
exit 1
