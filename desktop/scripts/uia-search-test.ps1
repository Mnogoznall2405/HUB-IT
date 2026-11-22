param(
    [string]$SetSearch,
    [string]$InvokeName = '',
    [string]$ToggleName = '',
    [string]$DumpMatch = '',
    [switch]$DumpAllText,
    [int]$WaitSec = 4
)
. $PSScriptRoot\_uia-root.ps1
$root = Get-HubRoot
if (-not $root) { Write-Output 'no window'; exit 1 }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)

if ($PSBoundParameters.ContainsKey('SetSearch')) {
    foreach ($e in $all) {
        if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and $e.Current.AutomationId -eq 'SearchInput') {
            try {
                $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($SetSearch)
                Write-Output "search set to [$SetSearch]"
            } catch { Write-Output "setvalue failed: $_" }
            break
        }
    }
}
if ($InvokeName) {
    foreach ($e in $all) {
        if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $e.Current.Name -eq $InvokeName) {
            try { $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); Write-Output "invoked: $InvokeName" } catch { Write-Output "invoke failed: $_" }
            break
        }
    }
}
if ($ToggleName) {
    foreach ($e in $all) {
        if ($e.Current.Name -eq $ToggleName) {
            try {
                $t = $e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
                $t.Toggle()
                Write-Output "toggled: $ToggleName -> $($t.Current.ToggleState)"
            } catch { Write-Output "toggle failed: $_" }
            break
        }
    }
}
if ($WaitSec -gt 0) { Start-Sleep $WaitSec }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)

if ($DumpAllText) {
    foreach ($e in $all) {
        $n = $e.Current.Name; $r = $e.Current.BoundingRectangle
        if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text -and $n -and $r.Width -gt 0 -and -not $e.Current.IsOffscreen) {
            Write-Output ('TXT | ' + $n.Substring(0, [Math]::Min(70, $n.Length)) + ' | x=' + [int]$r.X + ' y=' + [int]$r.Y)
        }
    }
}
if ($DumpMatch) {
    $li = 0
    $pats = $DumpMatch -split ','
    foreach ($e in $all) {
        $n = $e.Current.Name
        foreach ($pat in $pats) {
            if ($n -like $pat) {
                $li++
                Write-Output ($e.Current.ControlType.ProgrammaticName + ' | ' + $n.Substring(0, [Math]::Min(70, $n.Length)) + ' | en=' + $e.Current.IsEnabled)
                break
            }
        }
    }
    Write-Output "matches: $li"
}
# всегда: считаем видимые строки списка (ListItem под списком писем)
$rows = 0
foreach ($e in $all) {
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::ListItem -and -not $e.Current.IsOffscreen) { $rows++ }
}
Write-Output "visible listitems: $rows"
