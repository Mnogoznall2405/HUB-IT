# Pin Kotlin 1.9.25 for expo-modules-core Compose (RN gradle-plugin ships 1.9.24).
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$nm = Join-Path $root 'node_modules'

$files = @(
  (Join-Path $nm '@react-native\gradle-plugin\gradle\libs.versions.toml'),
  (Join-Path $nm 'react-native\gradle\libs.versions.toml'),
  (Join-Path $nm 'expo-modules-core\android\ExpoModulesCorePlugin.gradle')
)

foreach ($path in $files) {
  if (-not (Test-Path $path)) { continue }
  $text = Get-Content -Path $path -Raw -Encoding UTF8
  $next = $text -replace 'kotlin = "1\.9\.24"', 'kotlin = "1.9.25"'
  $next = $next -replace ': "1\.9\.24"', ': "1.9.25"'
  if ($next -ne $text) {
    Set-Content -Path $path -Value $next -Encoding UTF8 -NoNewline
    Write-Host "patched: $path"
  }
}
