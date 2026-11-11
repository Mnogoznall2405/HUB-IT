param(
    [Parameter(Mandatory = $true)]
    [string]$TaskName
)

# Removes a user-session probe task (Telegram/MAX) that the MSI no longer registers.
# Idempotent: a missing task is not an error, so upgrades can call it on every install.
$ErrorActionPreference = "Stop"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -eq $task) {
    Write-Host "Scheduled task '$TaskName' is not registered; nothing to remove."
    exit 0
}

try {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
} catch {
    Write-Warning "Stop-ScheduledTask '$TaskName' failed: $($_.Exception.Message)"
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Scheduled task '$TaskName' removed."
