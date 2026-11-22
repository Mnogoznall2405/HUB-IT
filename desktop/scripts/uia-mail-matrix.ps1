# Матрица писем: открывает письма по индексам и проверяет геометрию тела
# (WebView2 внутри области чтения — детектор «белого прямоугольника»).
# Пороги: webview.top >= header.bottom-12; webview.bottom <= окно-28 (статус-бар);
# webview.right <= header.right+22 (панель чтения). У каждого письма печатается,
# какой слой тела показан (webview/plain/оба/ни один).
param(
    [string]$ListName = 'Список писем',
    [string]$Indexes = '0,1,2,3,4,5',
    [int]$SettleSeconds = 5
)
. $PSScriptRoot\_uia-root.ps1
[int[]]$indexList = $Indexes.Split(',') | Where-Object { $_.Trim() -match '^\d+$' } | ForEach-Object { [int]$_.Trim() }
$root = Get-HubRoot
if (-not $root) { Write-Output 'no window'; exit 1 }
$win = $root.Current.BoundingRectangle

function Find-Descendants($scopeRoot) {
    $scopeRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
}

# Список писем
$list = $null
foreach ($e in (Find-Descendants $root)) {
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::List -and $e.Current.Name -eq $ListName) { $list = $e; break }
}
if (-not $list) { Write-Output 'list not found'; exit 1 }
$items = @()
foreach ($it in (Find-Descendants $list)) {
    if ($it.Current.ControlType -eq [System.Windows.Automation.ControlType]::ListItem) { $items += $it }
}
Write-Output ("items: $($items.Count)")

function Inspect-Body([string]$label) {
    $all = Find-Descendants $root
    $webview = $null; $header = $null; $plain = $null
    foreach ($e in $all) {
        if (-not $webview -and $e.Current.ClassName -eq 'Chrome_WidgetWin_1') { $webview = $e }
        if (-not $header -and $e.Current.Name -eq 'Сведения о письме') { $header = $e }
        if (-not $plain -and $e.Current.Name -eq 'Текст письма' -and $e.Current.ControlType.ProgrammaticName -match 'Pane') { $plain = $e }
    }
    $wr = if ($webview) { $webview.Current.BoundingRectangle } else { $null }
    $hr = if ($header) { $header.Current.BoundingRectangle } else { $null }
    $pr = if ($plain) { $plain.Current.BoundingRectangle } else { $null }
    $layer = if ($wr -and $wr.Height -gt 40) { 'webview' } elseif ($pr -and $pr.Height -gt 40) { 'plain' } else { 'none' }
    Write-Output ("== $label : body layer=$layer")
    if ($hr) { Write-Output ("   header rect: y=$([int]$hr.Y) h=$([int]$hr.Height) right=$([int]$hr.Right)") }
    if ($wr) {
        Write-Output ("   webview rect: x=$([int]$wr.X) y=$([int]$wr.Y) w=$([int]$wr.Width) h=$([int]$wr.Height) offscreen=$($webview.Current.IsOffscreen)")
        if ($hr) {
            # RowDefinition шапки ограничен MaxHeight=340: при длинной шапке
            # UIA-rect ScrollViewer завышен (padding сверх клипа) — сравниваем
            # с клипнутым низом строки, а не с сырым rect.
            $cappedBottom = $hr.Y + [Math]::Min($hr.Height, 340)
            if ($wr.Y -lt $cappedBottom - 12) { Write-Output ("   FAIL: webview top above header bottom (overlap header)") }
            if ($wr.Bottom -gt $win.Bottom - 26) { Write-Output ("   FAIL: webview bottom past status bar -> WHITE RECTANGLE risk") }
            if ($wr.Right -gt $hr.Right + 22) { Write-Output ("   FAIL: webview right beyond reading pane") }
            if ($wr.X -lt $hr.X - 4) { Write-Output ("   FAIL: webview left of reading pane") }
            if (($wr.Bottom -gt $win.Bottom - 26) -or ($wr.Y -lt $cappedBottom - 12)) { } else {
                Write-Output ("   OK: webview confined to body row (header capped.bottom=$([int]$cappedBottom) .. window.bottom-26=$([int]($win.Bottom - 26)))")
            }
        }
    }
    if ($pr -and $pr.Height -gt 0) {
        Write-Output ("   plain rect: x=$([int]$pr.X) y=$([int]$pr.Y) w=$([int]$pr.Width) h=$([int]$pr.Height)")
        if ($pr.Bottom -gt $win.Bottom - 26) { Write-Output ("   FAIL: plain body past status bar") }
    }
}

foreach ($idx in $indexList) {
    if ($idx -ge $items.Count) { Write-Output ("index $idx out of range"); continue }
    $sel = $items[$idx]
    $name = $sel.Current.Name
    $short = $name.Substring(0, [Math]::Min(90, $name.Length))
    try {
        $sel.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select() | Out-Null
    } catch { Write-Output ("select failed: $_"); continue }
    Start-Sleep $SettleSeconds
    Inspect-Body $short
}
