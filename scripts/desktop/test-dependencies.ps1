[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$solution = Join-Path $repoRoot 'desktop\Hub.Desktop.sln'
$nugetConfig = Join-Path $repoRoot 'desktop\NuGet.Config'
$dotnet = Join-Path $repoRoot 'tools\dotnet-sdk-8\dotnet.exe'
if (-not (Test-Path -LiteralPath $dotnet -PathType Leaf)) {
    $dotnet = (Get-Command dotnet -ErrorAction Stop).Source
}

$rawOutput = & $dotnet list $solution package `
    --vulnerable `
    --include-transitive `
    --format json `
    --output-version 1 `
    --config $nugetConfig
if ($LASTEXITCODE -ne 0) {
    throw "NuGet vulnerability query failed with exit code $LASTEXITCODE"
}

try {
    $report = ([string]::Join([Environment]::NewLine, @($rawOutput))) | ConvertFrom-Json
}
catch {
    throw "NuGet vulnerability query returned invalid JSON: $($_.Exception.Message)"
}

if ([int]$report.version -ne 1 -or $null -eq $report.projects) {
    throw 'NuGet vulnerability report has an unsupported schema.'
}

$findings = [System.Collections.Generic.List[object]]::new()
foreach ($project in @($report.projects)) {
    $projectName = [IO.Path]::GetFileName([string]$project.path)
    $frameworksProperty = $project.PSObject.Properties['frameworks']
    if ($null -eq $frameworksProperty) {
        continue
    }
    foreach ($framework in @($frameworksProperty.Value)) {
        $allPackages = [System.Collections.Generic.List[object]]::new()
        foreach ($propertyName in @('topLevelPackages', 'transitivePackages')) {
            $packageProperty = $framework.PSObject.Properties[$propertyName]
            if ($null -ne $packageProperty) {
                foreach ($package in @($packageProperty.Value)) {
                    $allPackages.Add($package)
                }
            }
        }
        foreach ($package in $allPackages) {
            $vulnerabilityProperty = $package.PSObject.Properties['vulnerabilities']
            if ($null -eq $vulnerabilityProperty) {
                continue
            }
            foreach ($vulnerability in @($vulnerabilityProperty.Value)) {
                $findings.Add([pscustomobject]@{
                    Project = $projectName
                    Framework = [string]$framework.framework
                    Package = [string]$package.id
                    Version = [string]$package.resolvedVersion
                    Severity = [string]$vulnerability.severity
                    Advisory = [string]$vulnerability.advisoryurl
                })
            }
        }
    }
}

if ($findings.Count -gt 0) {
    $summary = $findings |
        ForEach-Object { "$($_.Project): $($_.Package) $($_.Version) [$($_.Severity)] $($_.Advisory)" }
    throw "Known vulnerable NuGet dependencies were found:`n$($summary -join [Environment]::NewLine)"
}

[pscustomobject]@{
    Projects = @($report.projects).Count
    Sources = @($report.sources) -join ', '
    Vulnerabilities = 0
    Status = 'Passed'
}
