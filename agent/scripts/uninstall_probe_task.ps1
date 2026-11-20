param(
    [Parameter(Mandatory = $true)]
    [string]$TaskName
)

# Removes a legacy user-session DLP probe task without deleting its runtime data.
# Idempotent: a missing task is not an error, so upgrades can call it on every install.
$ErrorActionPreference = "Stop"

$task = Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskName -eq $TaskName }
if ($null -eq $task) {
    Write-Host "Scheduled task '$TaskName' is not registered; nothing to remove."
    exit 0
}

try {
    $task | Stop-ScheduledTask -ErrorAction Stop
} catch {
    throw "Cannot stop legacy DLP task '$TaskName': $($_.Exception.Message)"
}

$task | Unregister-ScheduledTask -Confirm:$false -ErrorAction Stop
Write-Host "Scheduled task '$TaskName' removed."
