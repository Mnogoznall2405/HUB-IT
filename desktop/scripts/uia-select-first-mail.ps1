param([int]$Index = 0, [string]$ListName = '', [switch]$DumpDetail)
. $PSScriptRoot\_uia-root.ps1
$root = Get-HubRoot
if (-not $root) { Write-Output 'no window'; exit 1 }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$list = $null
foreach ($e in $all) {
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::List -and $e.Current.Name -eq $ListName) { $list = $e; break }
}
if (-not $list) { Write-Output 'list not found'; exit 1 }
$items = $list.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$i = 0; $sel = $null
foreach ($it in $items) {
    if ($it.Current.ControlType -eq [System.Windows.Automation.ControlType]::ListItem) {
        if ($i -eq $Index) { $sel = $it; break }
        $i++
    }
}
if (-not $sel) { Write-Output "item $Index not found ($i items)"; exit 1 }
try { $sel.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select(); Write-Output ("selected: " + $sel.Current.Name.Substring(0, [Math]::Min(70, $sel.Current.Name.Length))) } catch { Write-Output "select failed: $_" }
Start-Sleep 4
if ($DumpDetail) {
    $all2 = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($e in $all2) {
        $ct = $e.Current.ControlType.ProgrammaticName; $r = $e.Current.BoundingRectangle
        if (($ct -match 'Document|ScrollBar') -and $r.Width -gt 50 -and $r.Width -lt 3000) {
            Write-Output ($ct + ' | ' + $e.Current.Name.Substring(0, [Math]::Min(50, $e.Current.Name.Length)) + ' | x=' + [int]$r.X + ' y=' + [int]$r.Y + ' w=' + [int]$r.Width + ' h=' + [int]$r.Height + ' off=' + $e.Current.IsOffscreen)
        }
    }
}
