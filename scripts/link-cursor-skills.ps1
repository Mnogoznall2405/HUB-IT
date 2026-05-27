# Связывает .cursor/skills с .opencode/skills (Windows junction).
# Запуск из корня репозитория: .\scripts\link-cursor-skills.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$target = Join-Path $root '.opencode\skills'
$link = Join-Path $root '.cursor\skills'

if (-not (Test-Path $target)) {
    Write-Error "Нет каталога $target — сначала установите скиллы в .opencode/skills."
}

New-Item -ItemType Directory -Force (Join-Path $root '.cursor') | Out-Null

if (Test-Path $link) {
    $item = Get-Item $link -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        $existing = $item.Target
        if ($existing -and ($existing | ForEach-Object { (Resolve-Path $_ -ErrorAction SilentlyContinue).Path }) -contains (Resolve-Path $target).Path) {
            Write-Host "Уже связано: $link -> $target"
            exit 0
        }
        Remove-Item $link -Force
    } else {
        Write-Error "$link существует и это не junction. Удалите вручную и запустите снова."
    }
}

cmd /c "mklink /J `"$link`" `"$target`""
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Готово: $link -> $target"
