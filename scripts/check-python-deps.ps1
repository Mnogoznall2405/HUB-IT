param(
    [switch]$Audit,
    [switch]$Environment
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $RepoRoot
try {
    if ($Environment) {
        Write-Host "Checking installed Python environment dependency consistency..."
        python -m pip check
        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }
    } else {
        Write-Host "Skipped global Python environment check. Use -Environment to run pip check for this interpreter."
    }

    if ($Audit) {
        Write-Host "Running pip-audit against pinned project constraints..."
        $PreviousPythonUtf8 = $env:PYTHONUTF8
        $env:PYTHONUTF8 = "1"

        $AuditExitCode = 0
        $AuditRequirementFiles = @(
            "constraints.txt",
            "WEB-itinvent\backend\constraints.txt",
            "scan_server\constraints.txt"
        )

        foreach ($RequirementFile in $AuditRequirementFiles) {
            Write-Host "Auditing $RequirementFile"
            python -m pip_audit -r $RequirementFile
            if ($LASTEXITCODE -ne 0) {
                $AuditExitCode = $LASTEXITCODE
            }
        }

        $env:PYTHONUTF8 = $PreviousPythonUtf8
        if ($AuditExitCode -ne 0) {
            exit $AuditExitCode
        }
    } else {
        Write-Host "Skipped pip-audit. Install pip-audit and re-run with -Audit for CVE checks."
    }
}
finally {
    Pop-Location
}
