param([string]$NameMatch = '', [switch]$Select, [string]$Dump = '')
. $PSScriptRoot\_uia-root.ps1
$root = Get-HubRoot
if (-not $root) { Write-Output 'no window'; exit 1 }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
if ($Select -and $NameMatch) {
    foreach ($e in $all) {
        $n = $e.Current.Name
        if ($n -like $NameMatch -and $e.Current.ControlType -eq [System.Windows.Automation.ControlType]::ListItem) {
            try { $e.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select(); Write-Output "selected: $($n.Substring(0,[Math]::Min(50,$n.Length)))" } catch { Write-Output "select failed: $_" }
            break
        }
    }
    Start-Sleep 3
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
}
if ($Dump) {
    $pats = $Dump -split ','
    foreach ($e in $all) {
        $n = $e.Current.Name; $r = $e.Current.BoundingRectangle
        foreach ($pat in $pats) {
            if ($n -match $pat -and $r.Width -lt 3000) {
                $xs = '?'; $ws = '?'
                try { $xs = [int]$r.X; $ws = [int]$r.Width } catch {}
                Write-Output ($e.Current.ControlType.ProgrammaticName + ' | ' + $n.Substring(0, [Math]::Min(55, $n.Length)) + ' | x=' + $xs + ' w=' + $ws + ' off=' + $e.Current.IsOffscreen)
                break
            }
        }
    }
}
