# Отправляет JSON-команду живому WPF-стенду (WebParityStand) и ждёт .done.json.
# Usage: .\stand_cmd.ps1 <name> '<json>' [-TimeoutSec 60]
param(
    [Parameter(Mandatory=$true)][string]$Name,
    [Parameter(Mandatory=$true)][string]$Json,
    [int]$TimeoutSec = 90,
    [string]$CmdDir = "C:\Project\HUB-IT-main\ui-review\stand\wpf-cmd"
)
$stamp = Get-Date -Format "HHmmssfff"
$cmdFile = Join-Path $CmdDir "$Name-$stamp.cmd.json"
$doneFile = Join-Path $CmdDir "$Name-$stamp.done.json"
# Атомарная запись: стенд не должен увидеть файл посередине записи.
$tmpFile = "$cmdFile.tmp"
Set-Content -Path $tmpFile -Value $Json -Encoding UTF8
Move-Item -Force $tmpFile $cmdFile
$deadline = (Get-Date).AddSeconds($TimeoutSec)
while (-not (Test-Path $doneFile) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 120 }
if (Test-Path $doneFile) { Get-Content $doneFile -Raw } else { "TIMEOUT $Name" }
