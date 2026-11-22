param([string]$Path)
$x = Get-Content -Raw $Path
$rx = [regex]'(?s)<ItemsControl(?=[\s>])([^>]*)>'
$ms = $rx.Matches($x)
$noName = 0
foreach ($m in $ms) {
    $tag = $m.Groups[1].Value
    $ln = ($x.Substring(0, $m.Index) -split "`n").Count
    $hasName = $tag -match 'AutomationProperties\.Name'
    $end = $x.IndexOf('</ItemsControl>', $m.Index)
    if ($end -lt 0) { $end = $m.Index + 3000 }
    $seg = $x.Substring($m.Index, [Math]::Min($end - $m.Index, 4000))
    $hasStyle = $seg -match 'ItemContainerStyle'
    if (-not $hasName -and -not $hasStyle) {
        $noName++
        $src = '?'
        if ($tag -match 'ItemsSource="\{Binding ([^ }]+)') { $src = $Matches[1] }
        Write-Output ("{0} : {1}" -f $ln, $src)
    }
}
Write-Output ("remaining: {0}" -f $noName)
