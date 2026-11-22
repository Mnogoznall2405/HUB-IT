$dir = 'C:\Project\HUB-IT-main\desktop\Hub.Desktop\Native\Views'
$rx = [regex]'(?s)<ListBox(?=[\s>])([^>]*)>'
foreach ($p in (Get-ChildItem (Join-Path $dir '*.xaml'))) {
    $x = Get-Content -Raw $p.FullName
    $ms = $rx.Matches($x)
    foreach ($m in $ms) {
        $tag = $m.Groups[1].Value
        $ln = ($x.Substring(0, $m.Index) -split "`n").Count
        $end = $x.IndexOf('</ListBox>', $m.Index)
        if ($end -lt 0) { $end = $x.Length }
        $seg = $x.Substring($m.Index, $end - $m.Index)
        if ($seg -match 'ItemContainerStyle') { continue }
        $src = '?'
        if ($tag -match 'ItemsSource="\{Binding ([^ }]+)') { $src = $Matches[1] }
        $prop = '?'
        # первый AutomationProperties.Name внутри шаблона
        if ($seg -match 'AutomationProperties\.Name="\{Binding ([^ ,}]+)') { $prop = 'AUTO:' + $Matches[1] }
        elseif ($seg -match 'Text="\{Binding ([^ ,}]+)') { $prop = $Matches[1] }
        Write-Output ('{0} : {1} : {2} -> {3}' -f $p.Name, $ln, $src, $prop)
    }
}
