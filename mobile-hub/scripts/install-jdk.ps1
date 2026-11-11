#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
$tools = Join-Path (Split-Path $PSScriptRoot -Parent | Split-Path -Parent) 'tools'
New-Item -ItemType Directory -Path $tools -Force | Out-Null
$zip = Join-Path $tools 'jdk17.zip'
if (-not (Test-Path $zip) -or (Get-Item $zip).Length -lt 100MB) {
  Write-Host 'Downloading Temurin JDK 17...'
  curl.exe -L -o $zip 'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk'
}
$existing = Get-ChildItem $tools -Directory | Where-Object { $_.Name -like 'jdk*' } | Select-Object -First 1
if (-not $existing) {
  tar -xf $zip -C $tools
}
$jdk = Get-ChildItem $tools -Directory | Where-Object { $_.Name -like 'jdk*' } | Select-Object -First 1
& (Join-Path $jdk.FullName 'bin\java.exe') -version
Write-Host "JDK ready: $($jdk.FullName)"
