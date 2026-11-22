param([int]$MinX = 0, [int]$MaxX = 500, [int]$MinY = 0, [int]$MaxY = 2000)
. $PSScriptRoot\_uia-root.ps1
$root = Get-HubRoot
if (-not $root) { Write-Output 'no window'; exit 1 }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
    $r = $e.Current.BoundingRectangle
    if ($r.X -ge $MinX -and $r.X -le $MaxX -and $r.Y -ge $MinY -and $r.Y -le $MaxY -and $r.Width -gt 0 -and $r.Width -lt 3000 -and -not $e.Current.IsOffscreen) {
        Write-Output ($e.Current.ControlType.ProgrammaticName + ' | ' + $e.Current.Name.Substring(0, [Math]::Min(55, $e.Current.Name.Length)) + ' | x=' + [int]$r.X + ' y=' + [int]$r.Y + ' w=' + [int]$r.Width + ' h=' + [int]$r.Height)
    }
}
