param([double]$Pct = -1)
. $PSScriptRoot\_uia-root.ps1
$root = Get-HubRoot
if (-not $root) { Write-Output 'no window'; exit 1 }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$i = 0
foreach ($e in $all) {
    $r = $e.Current.BoundingRectangle
    if ($r.Width -le 0 -or $e.Current.IsOffscreen) { continue }
    try {
        $sp = $e.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
    } catch { continue }
    $i++
    $ct = $e.Current.ControlType.ProgrammaticName
    $nm = $e.Current.Name
    if ($null -eq $nm) { $nm = '' }
    $vs = $sp.Current.VerticallyScrollable
    $vp = [int]$sp.Current.VerticalScrollPercent
    $vsz = [int]$sp.Current.VerticalViewSize
    Write-Output ("scroll#$i " + $ct + " name=" + $nm + " x=" + [int]$r.X + " w=" + [int]$r.Width + " vs=" + $vs + " pct=" + $vp + " vsize=" + $vsz)
    if ($Pct -ge 0 -and $vs -and $r.X -gt 800) {
        try { $sp.SetScrollPercent(-1, $Pct); Write-Output "  -> set pct=$Pct" } catch { Write-Output "  set failed: $_" }
    }
}
