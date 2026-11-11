[CmdletBinding(SupportsShouldProcess)]
param(
  [switch]$Apply,
  [switch]$RefreshBinding
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$leafThumbprint = 'B3D1AF5755A8A337BB7E5F293F6411B152691348'
$hostnamePort = 'hubit.zsgp.ru:443'
$appId = '{4dc3e181-e14b-4a21-b022-59fc669b0914}'
$leaf = Get-Item -LiteralPath "Cert:\LocalMachine\My\$leafThumbprint"
if ($leaf.NotAfter -le (Get-Date) -or -not $leaf.HasPrivateKey) { throw 'Expected active IIS certificate is unavailable' }
$binding = (& netsh http show sslcert "hostnameport=$hostnamePort") -join "`n"
if ($LASTEXITCODE -ne 0 -or $binding -notmatch $leafThumbprint -or $binding -notmatch ([regex]::Escape($appId))) {
  throw 'HTTPS binding differs from the reviewed target; no changes made'
}

$specifications = @(
  @{ File = 'globalsign-gcc-r46-ov-tls-ca-2025.pem'; Thumbprint = '82F8D711875FA3B9CF9201ABF6224FBAC6712770' },
  @{ File = 'globalsign-r46-cross-r3.pem'; Thumbprint = 'B52403B71D0F2457BA45B6E70CA82C83FEB7E615' }
)
$certificates = foreach ($specification in $specifications) {
  $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new((Join-Path $PSScriptRoot ('certs\' + $specification.File)))
  if ($certificate.Thumbprint -ne $specification.Thumbprint -or $certificate.NotAfter -le (Get-Date) -or $certificate.HasPrivateKey) {
    throw 'Unexpected public intermediate certificate; no changes made'
  }
  [pscustomobject]@{
    Certificate = $certificate
    Thumbprint = $certificate.Thumbprint
    Existed = Test-Path -LiteralPath ("Cert:\LocalMachine\CA\" + $certificate.Thumbprint)
  }
}

[pscustomobject]@{
  Mode = $(if ($Apply) { 'Apply' } else { 'Read-only plan' })
  Binding = $hostnamePort
  LeafThumbprint = $leafThumbprint
  AddToLocalMachineCA = @($certificates | Where-Object { -not $_.Existed } | ForEach-Object Thumbprint)
  RefreshSameBinding = [bool]$RefreshBinding
  RootStoreChanges = $false
  RestartProcesses = $false
} | ConvertTo-Json
if (-not $Apply -or -not $PSCmdlet.ShouldProcess($hostnamePort, 'Install the two reviewed public CA certificates and optionally refresh this same SSL binding')) { return }

$backupRoot = Join-Path $repoRoot ('artifacts\iis\mobile-tls-chain-' + [DateTimeOffset]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
Set-Content -LiteralPath (Join-Path $backupRoot 'ssl-binding-before.txt') -Value $binding -Encoding UTF8
$state = [ordered]@{
  CreatedAt = [DateTimeOffset]::UtcNow.ToString('o')
  Binding = $hostnamePort
  LeafThumbprint = $leafThumbprint
  NewlyAddedCAThumbprints = @($certificates | Where-Object { -not $_.Existed } | ForEach-Object Thumbprint)
  RootStoreChanged = $false
}
$state | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backupRoot 'state.json') -Encoding UTF8
$store = [Security.Cryptography.X509Certificates.X509Store]::new('CA', 'LocalMachine')
try {
  $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
  foreach ($item in $certificates) {
    if (-not $item.Existed) { $store.Add($item.Certificate) }
  }
} finally { $store.Close() }
foreach ($item in $certificates) {
  if (-not (Test-Path -LiteralPath ("Cert:\LocalMachine\CA\" + $item.Thumbprint))) { throw 'CA installation verification failed' }
}
if ($RefreshBinding) {
  & netsh http update sslcert "hostnameport=$hostnamePort" "certhash=$leafThumbprint" "appid=$appId" 'certstorename=MY'
  if ($LASTEXITCODE -ne 0) { throw "SSL binding refresh failed. Backup: $backupRoot" }
}
Write-Output "Backup: $backupRoot"
Write-Output 'CA certificates installed. The actual wire chain must still pass check-mobile-tls.py and a device retry.'
