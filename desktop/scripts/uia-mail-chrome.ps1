# Аудит хрома нативной почты: геометрия командной панели, заголовка списка,
# пустого состояния чтения. Проверяет наложения, центровку поиска, ширину
# заголовка папки. Только чтение UIA — ничего не кликает.
param([switch]$OverlapCheck)
. $PSScriptRoot\_uia-root.ps1
$root = Get-HubRoot
if (-not $root) { Write-Output 'no window'; exit 1 }
$win = $root.Current.BoundingRectangle
Write-Output ("window: x=$([int]$win.X) y=$([int]$win.Y) w=$([int]$win.Width) h=$([int]$win.Height)")

$watch = @{
    'Новое письмо'                              = $null
    'Открыть форму заявки в IT'                 = $null
    'Ответить на письмо'                        = $null
    'Удалить письмо в папку «Удалённые»'        = $null
    'Другие действия с письмом'                = $null
    'Поиск по письмам'                          = $null
    'Искать во всех папках'                     = $null
    'Обновить папки и письма'                   = $null
    'Выберите письмо'                           = $null
    'Подсказки по работе со списком писем'      = $null
    'Выбрать все загруженные письма'            = $null
    'Фильтр: все письма'                        = $null
    'Фильтр: непрочитанные письма'              = $null
    'Разделитель папок и списка писем'          = $null
    'Разделитель списка и чтения письма'        = $null
    'Свернуть панель папок'                     = $null
    'Развернуть панель папок'                   = $null
}
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($e in $all) {
    $n = $e.Current.Name
    if ($watch.ContainsKey($n) -and -not $watch[$n]) {
        $r = $e.Current.BoundingRectangle
        if ($r.Width -gt 0) { $watch[$n] = $r }
    }
}
foreach ($k in $watch.Keys) {
    $r = $watch[$k]
    if ($r) { Write-Output ("$k | x=$([int]$r.X) y=$([int]$r.Y) w=$([int]$r.Width) h=$([int]$r.Height)") }
    else    { Write-Output ("$k | NOT FOUND") }
}

# Заголовок списка: имя «Текущая папка: …» / «Область поиска: …» — ищем по префиксу.
foreach ($e in $all) {
    $n = $e.Current.Name
    if ($n -like 'Текущая папка: *' -or $n -like 'Область поиска: *') {
        $r = $e.Current.BoundingRectangle
        Write-Output ("list header: $n | x=$([int]$r.X) y=$([int]$r.Y) w=$([int]$r.Width) h=$([int]$r.Height)")
        break
    }
}

# Попарные наложения среди кнопок тулбара (один ряд, y близок).
if ($OverlapCheck) {
    $names = @('Новое письмо','Открыть форму заявки в IT','Ответить на письмо','Удалить письмо в папку «Удалённые»','Другие действия с письмом','Поиск по письмам','Искать во всех папках','Обновить папки и письма')
    $rects = @{}
    foreach ($e in $all) {
        $n = $e.Current.Name
        if ($names -contains $n -and -not $rects.ContainsKey($n)) {
            $r = $e.Current.BoundingRectangle
            if ($r.Width -gt 0) { $rects[$n] = $r }
        }
    }
    $list = @($rects.Keys)
    for ($i = 0; $i -lt $list.Count; $i++) {
        for ($j = $i + 1; $j -lt $list.Count; $j++) {
            $a = $rects[$list[$i]]; $b = $rects[$list[$j]]
            $overlapX = [Math]::Min($a.Right, $b.Right) - [Math]::Max($a.X, $b.X)
            $overlapY = [Math]::Min($a.Bottom, $b.Bottom) - [Math]::Max($a.Y, $b.Y)
            if ($overlapX -gt 1 -and $overlapY -gt 1) {
                Write-Output ("OVERLAP: $($list[$i]) x $($list[$j]) overlapX=$([int]$overlapX) overlapY=$([int]$overlapY)")
            }
        }
    }
    # Центровка поиска: сравниваем зазоры слева/справа от поля в свободной колонке.
    $search = $rects['Поиск по письмам']
    $more = $rects['Другие действия с письмом']
    $scope = $rects['Искать во всех папках']
    if ($search -and $more -and $scope) {
        $gapLeft = $search.X - $more.Right
        $gapRight = $scope.X - $search.Right
        Write-Output ("search gaps: left=$([int]$gapLeft) right=$([int]$gapRight)")
    }
}
