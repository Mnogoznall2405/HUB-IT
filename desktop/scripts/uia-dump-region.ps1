param([int]$MinX = 1000, [string]$TypeFilter = '')
. $PSScriptRoot\_uia-root.ps1
$root = Get-HubRoot
if (-not $root) { Write-Output 'no window'; exit 1 }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
    $r = $e.Current.BoundingRectangle
    $ct = $e.Current.ControlType.ProgrammaticName
    if ($r.X -ge $MinX -and $r.Width -gt 0 -and $r.Width -lt 3000 -and -not $e.Current.IsOffscreen) {
        if ($TypeFilter -eq '' -or $ct -match $TypeFilter) {
            Write-Output ($ct + ' | ' + $e.Current.Name.Substring(0, [Math]::Min(55, $e.Current.Name.Length)) + ' | x=' + [int]$r.X + ' y=' + [int]$r.Y + ' w=' + [int]$r.Width)
        }
    }
}
