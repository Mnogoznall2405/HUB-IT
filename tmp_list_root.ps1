$itDir = Get-ChildItem '\\10.103.0.170\Common\IT' -Directory | Where-Object { $_.Name -match '^\u0410\u0431\u0434\u0443' } | Select-Object -First 1
Get-ChildItem -LiteralPath $itDir.FullName -Directory | Select-Object -ExpandProperty Name
