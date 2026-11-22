. $PSScriptRoot\_uia-root.ps1
$root = Get-HubRoot
if (-not $root) { Write-Output 'no window'; exit 1 }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$interactive = @('ControlType.Button','ControlType.Edit','ControlType.CheckBox','ControlType.RadioButton','ControlType.ComboBox','ControlType.List','ControlType.ListItem','ControlType.MenuItem','ControlType.TabItem','ControlType.Hyperlink','ControlType.Slider','ControlType.Spinner','ControlType.TreeItem','ControlType.DataItem','ControlType.Group')
$bad = 0
foreach ($e in $all) {
    $ct = $e.Current.ControlType.ProgrammaticName
    if ($interactive -notcontains $ct) { continue }
    if ($e.Current.IsOffscreen) { continue }
    $n = $e.Current.Name
    $r = $e.Current.BoundingRectangle
    if ($r.Width -le 0) { continue }
    $isBad = $false
    $why = ''
    if ([string]::IsNullOrWhiteSpace($n)) { $isBad = $true; $why = 'EMPTY NAME' }
    elseif ($n -match 'ViewModel|Hub\.Desktop|System\.') { $isBad = $true; $why = 'TYPE NAME' }
    if ($isBad) {
        $bad++
        $cls = ''
        try { $cls = $e.Current.ClassName } catch {}
        Write-Output ("$why | $ct | cls=$cls | x=" + [int]$r.X + ' y=' + [int]$r.Y + ' w=' + [int]$r.Width + ' h=' + [int]$r.Height + ' | aid=' + $e.Current.AutomationId)
    }
}
Write-Output "bad: $bad"
