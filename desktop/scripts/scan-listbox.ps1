$dir = 'C:\Project\HUB-IT-main\desktop\Hub.Desktop\Native\Views'
$rx = [regex]'(?s)<ListBox(?=[\s>])([^>]*)>'
foreach ($p in (Get-ChildItem (Join-Path $dir '*.xaml'))) {
    $x = Get-Content -Raw $p.FullName
    $ms = $rx.Matches($x)
    $noName = 0
    foreach ($m in $ms) {
        $tag = $m.Groups[1].Value
        $ln = ($x.Substring(0, $m.Index) -split "`n").Count
        $end = $x.IndexOf('</ListBox>', $m.Index)
        if ($end -lt 0) { $end = $x.Length }
        $seg = $x.Substring($m.Index, $end - $m.Index)
        $hasStyle = $seg -match 'ItemContainerStyle'
        if (-not $hasStyle) {
            $noName++
            $src = '?'
            if ($tag -match 'ItemsSource="\{Binding ([^ }]+)') { $src = $Matches[1] }
            Write-Output ('{0} : {1} : {2}' -f $p.Name, $ln, $src)
        }
    }
}
