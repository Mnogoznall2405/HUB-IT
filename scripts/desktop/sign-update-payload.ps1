[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$SigningCertificateThumbprint,
    [Parameter(Mandatory)]
    [string]$PayloadBase64,
    [ValidateSet('Tls', 'Dedicated')]
    [string]$SigningKeyKind = 'Tls',
    [switch]$AllowShortCertificateLifetime
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$store = 'Cert:\LocalMachine\My'
$thumbprint = $SigningCertificateThumbprint.Replace(' ', '').ToUpperInvariant()
if ($thumbprint -notmatch '^[0-9A-F]{40}$') {
    throw 'Signing certificate thumbprint must contain exactly 40 hexadecimal characters.'
}

try {
    $payload = [Convert]::FromBase64String($PayloadBase64)
}
catch [FormatException] {
    throw 'Signing payload is not valid base64.'
}
if ($payload.Length -le 0 -or $payload.Length -gt 16KB) {
    throw 'Signing payload is outside the allowed size.'
}

$certificate = Get-Item -LiteralPath (Join-Path $store $thumbprint) -ErrorAction Stop
$now = [DateTime]::UtcNow
if ($certificate.NotBefore.ToUniversalTime() -gt $now -or
    $certificate.NotAfter.ToUniversalTime() -le $now) {
    throw 'The selected signing certificate is outside its validity period.'
}

if (-not $certificate.HasPrivateKey) {
    throw 'The selected signing certificate has no private key.'
}

$ekuExtension = @($certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.37' })
$ekuValues = @()
if ($ekuExtension.Count -eq 1) {
    $ekuValues = @($ekuExtension[0].EnhancedKeyUsages | ForEach-Object { $_.Value })
}

if ($SigningKeyKind -eq 'Dedicated') {
    if ($ekuValues -contains '1.3.6.1.5.5.7.3.1' -or
        -not ($ekuValues -contains '1.3.6.1.5.5.7.3.3')) {
        throw 'The selected certificate is not a dedicated update signing certificate.'
    }
    if ($certificate.NotAfter.ToUniversalTime() -le $now.AddDays(365)) {
        throw 'The dedicated update signing certificate is outside the permitted validity window.'
    }
}
else {
    $dnsNames = @($certificate.DnsNameList | ForEach-Object { $_.Unicode })
    if (($dnsNames -notcontains '*.zsgp.ru' -and $dnsNames -notcontains 'hubit.zsgp.ru') -or
        $certificate.Subject.Equals($certificate.Issuer, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The selected certificate is not a trusted production TLS certificate for hubit.zsgp.ru.'
    }

    if (-not $AllowShortCertificateLifetime -and
        $certificate.NotAfter.ToUniversalTime() -le $now.AddDays(30)) {
        throw 'The selected production TLS certificate is outside the permitted validity window.'
    }

    if (-not ($ekuValues -contains '1.3.6.1.5.5.7.3.1')) {
        throw 'The selected certificate is not valid for TLS server authentication.'
    }
}

$rsa = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey(
    $certificate)
if ($null -eq $rsa) {
    throw 'The selected signing certificate has no RSA private key.'
}

try {
    $signature = $rsa.SignData(
        $payload,
        [Security.Cryptography.HashAlgorithmName]::SHA256,
        [Security.Cryptography.RSASignaturePadding]::Pss)
    if (-not $rsa.VerifyData(
            $payload,
            $signature,
            [Security.Cryptography.HashAlgorithmName]::SHA256,
            [Security.Cryptography.RSASignaturePadding]::Pss)) {
        throw 'RSA-PSS signature self-check failed.'
    }

    [Convert]::ToBase64String($signature)
}
finally {
    $rsa.Dispose()
}
