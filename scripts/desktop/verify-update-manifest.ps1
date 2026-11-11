[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ManifestPath,
    [Parameter(Mandatory)]
    [string]$SetupPath,
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',
    [switch]$NoBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$dotnet = @(
    Join-Path $repoRoot 'tools\dotnet-sdk-8\dotnet.exe'
    Get-ChildItem -LiteralPath (Join-Path $repoRoot 'tools') -Directory -Filter 'dotnet-sdk-8*' -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        ForEach-Object { Join-Path $_.FullName 'dotnet.exe' }
) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
$project = Join-Path $repoRoot 'desktop\Hub.Desktop.UpdateVerifier\Hub.Desktop.UpdateVerifier.csproj'
$manifest = (Resolve-Path -LiteralPath $ManifestPath -ErrorAction Stop).Path
$setup = (Resolve-Path -LiteralPath $SetupPath -ErrorAction Stop).Path

if ($null -eq $dotnet) {
    $dotnet = (Get-Command dotnet -ErrorAction Stop).Source
}
$dotnet = [string]$dotnet

$arguments = @(
    'run',
    '--project', $project,
    '--configuration', $Configuration
)
if ($NoBuild) {
    $arguments += '--no-build'
}
$arguments += @(
    '--',
    '--manifest', $manifest,
    '--setup', $setup
)

& $dotnet @arguments
if ($LASTEXITCODE -ne 0) {
    throw "Desktop update verification failed with exit code $LASTEXITCODE"
}
