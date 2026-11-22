$itDir = Get-ChildItem '\\10.103.0.170\Common\IT' -Directory | Where-Object { $_.Name -match '^\u0410\u0431\u0434\u0443' } | Select-Object -First 1
$prev = Get-ChildItem -LiteralPath $itDir.FullName -Directory | Where-Object { $_.Name -like '!_*' } | Select-Object -First 1
"folder: $($prev.Name)"
(Get-ChildItem -LiteralPath $prev.FullName -Recurse -File | Measure-Object).Count
# sample jpg validity
$f = Get-ChildItem -LiteralPath $prev.FullName -Recurse -File | Select-Object -First 3
foreach($x in $f){ $b=New-Object byte[] 3; $fs=[IO.File]::OpenRead($x.FullName); $fs.Read($b,0,3)|Out-Null; $fs.Close(); "{0} {1}" -f $x.Name,(($b|ForEach-Object{'{0:X2}' -f $_}) -join '') }
