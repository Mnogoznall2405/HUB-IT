#Requires -Version 5.1
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
  [Parameter(Mandatory)]
  [string]$KeystorePath,
  [Parameter(Mandatory)]
  [string]$BackupPathOne,
  [Parameter(Mandatory)]
  [string]$BackupPathTwo,
  [ValidatePattern('^[A-Za-z0-9._-]{3,64}$')]
  [string]$Alias = 'hubit-mobile-release',
  [ValidateRange(3650, 18250)]
  [int]$ValidityDays = 9125,
  [string]$DistinguishedName = 'CN=HUB-IT Mobile, OU=IT, O=ZSGP, C=RU',
  [switch]$VerifyOnly,
  [switch]$AllowSameVolumeBackups
)

$ErrorActionPreference = 'Stop'
$mobileRoot = Split-Path $PSScriptRoot -Parent
$repoRoot = [IO.Path]::GetFullPath((Split-Path $mobileRoot -Parent)).TrimEnd('\', '/')

function Resolve-ExternalFilePath([string]$Path, [string]$Name) {
  if ([string]::IsNullOrWhiteSpace($Path)) { throw "$Name is required." }
  $resolved = [IO.Path]::GetFullPath($Path)
  if (
    $resolved.Equals($repoRoot, [StringComparison]::OrdinalIgnoreCase) -or
    $resolved.StartsWith($repoRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
  ) {
    throw "$Name must be outside the HUB-IT repository."
  }
  $parent = Split-Path $resolved -Parent
  if (-not $parent -or -not (Test-Path -LiteralPath $parent -PathType Container)) {
    throw "$Name parent directory must already exist: $parent"
  }
  return $resolved
}

function Resolve-KeytoolPath {
  $candidates = @()
  foreach ($javaHome in @($env:HUBIT_JAVA_HOME, $env:JAVA_HOME, 'C:\AndroidDev\jdk-17')) {
    if ($javaHome) { $candidates += Join-Path $javaHome 'bin\keytool.exe' }
  }
  $command = Get-Command keytool.exe -ErrorAction SilentlyContinue
  if ($command -and $command.Path) { $candidates += $command.Path }
  $keytool = $candidates |
    Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
    Select-Object -First 1
  if (-not $keytool) {
    throw 'keytool.exe was not found. Set HUBIT_JAVA_HOME to JDK 17.'
  }
  return [IO.Path]::GetFullPath([string]$keytool)
}

function Read-SigningPassword {
  if ($env:HUBIT_ANDROID_KEYSTORE_PASSWORD) {
    return [string]$env:HUBIT_ANDROID_KEYSTORE_PASSWORD
  }
  $secure = Read-Host 'Введите новый пароль release keystore (не менее 16 символов)' -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Get-SignerFingerprint([string]$Keytool, [string]$Path, [string]$KeyAlias) {
  $output = (& $Keytool -J-Duser.language=en -list -v -keystore $Path -alias $KeyAlias -storepass:env HUBIT_SIGNING_TOOL_PASSWORD 2>&1) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw 'Release keystore or alias validation failed.' }
  if ($output -notmatch '(?im)^\s*SHA-?256:\s*(?<digest>(?:[0-9A-F]{2}:){31}[0-9A-F]{2})\s*$') {
    throw 'Release signer SHA-256 fingerprint was not found.'
  }
  return (([string]$Matches.digest) -replace ':', '').ToLowerInvariant()
}

$keystore = Resolve-ExternalFilePath $KeystorePath 'KeystorePath'
$backupOne = Resolve-ExternalFilePath $BackupPathOne 'BackupPathOne'
$backupTwo = Resolve-ExternalFilePath $BackupPathTwo 'BackupPathTwo'
$uniquePaths = @(@($keystore, $backupOne, $backupTwo) | Sort-Object -Unique)
if ($uniquePaths.Count -ne 3) { throw 'Keystore and both backup paths must be different.' }

$backupRootOne = [IO.Path]::GetPathRoot($backupOne).TrimEnd('\', '/')
$backupRootTwo = [IO.Path]::GetPathRoot($backupTwo).TrimEnd('\', '/')
if (
  -not $AllowSameVolumeBackups -and
  $backupRootOne.Equals($backupRootTwo, [StringComparison]::OrdinalIgnoreCase)
) {
  throw 'The two backups must be on different volumes or network shares. Use -AllowSameVolumeBackups only after explicitly accepting this recovery risk.'
}

$keytool = Resolve-KeytoolPath
if ($VerifyOnly) {
  foreach ($path in @($keystore, $backupOne, $backupTwo)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "Signing file was not found: $path"
    }
  }
} else {
  foreach ($path in @($keystore, $backupOne, $backupTwo)) {
    if (Test-Path -LiteralPath $path) {
      throw "Refusing to overwrite an existing signing file: $path"
    }
  }
  if (-not $PSCmdlet.ShouldProcess($keystore, 'Create permanent Android release keystore and two encrypted byte-for-byte backups')) {
    return [pscustomobject]@{
      Mode = 'plan'
      Keystore = $keystore
      BackupOne = $backupOne
      BackupTwo = $backupTwo
      Alias = $Alias
      Keytool = $keytool
    }
  }
}

$password = Read-SigningPassword
if ([string]::IsNullOrWhiteSpace($password) -or $password.Length -lt 16) {
  throw 'Release keystore password must contain at least 16 characters.'
}
$previousToolPassword = [Environment]::GetEnvironmentVariable('HUBIT_SIGNING_TOOL_PASSWORD')
$env:HUBIT_SIGNING_TOOL_PASSWORD = $password
try {
  if (-not $VerifyOnly) {
    & $keytool -J-Duser.language=en -genkeypair `
      -keystore $keystore `
      -storetype PKCS12 `
      -alias $Alias `
      -keyalg RSA `
      -keysize 4096 `
      -sigalg SHA256withRSA `
      -validity $ValidityDays `
      -dname $DistinguishedName `
      -storepass:env HUBIT_SIGNING_TOOL_PASSWORD `
      -keypass:env HUBIT_SIGNING_TOOL_PASSWORD `
      -noprompt | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $keystore -PathType Leaf)) {
      throw 'keytool did not create the release keystore.'
    }
    Copy-Item -LiteralPath $keystore -Destination $backupOne
    Copy-Item -LiteralPath $keystore -Destination $backupTwo
  }

  $fingerprint = Get-SignerFingerprint $keytool $keystore $Alias
  $hashes = @(@($keystore, $backupOne, $backupTwo) | ForEach-Object {
    (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()
  })
  if (@($hashes | Sort-Object -Unique).Count -ne 1) {
    throw 'Keystore backups are not byte-for-byte identical.'
  }

  return [pscustomobject]@{
    Mode = if ($VerifyOnly) { 'verified' } else { 'created' }
    Keystore = $keystore
    BackupOne = $backupOne
    BackupTwo = $backupTwo
    Alias = $Alias
    SignerSHA256 = $fingerprint
    KeystoreFileSHA256 = $hashes[0]
    BuildEnvironment = [ordered]@{
      HUBIT_ANDROID_KEYSTORE_FILE = $keystore
      HUBIT_ANDROID_KEY_ALIAS = $Alias
      PasswordVariables = 'Set HUBIT_ANDROID_KEYSTORE_PASSWORD and HUBIT_ANDROID_KEY_PASSWORD to the same protected value.'
    }
  }
} finally {
  $password = $null
  if ($null -eq $previousToolPassword) {
    Remove-Item Env:HUBIT_SIGNING_TOOL_PASSWORD -ErrorAction SilentlyContinue
  } else {
    $env:HUBIT_SIGNING_TOOL_PASSWORD = $previousToolPassword
  }
}
