using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Hub.Desktop.UpdateCore;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopUpdateManifestVerifierTests
{
    private static readonly Uri HubBaseUri = new("https://hubit.zsgp.ru/");

    [Fact]
    public void LoadsExpectedPinnedProductionTlsCertificateWithoutPrivateKey()
    {
        using var certificate = DesktopUpdateTrust.LoadCertificate();
        using var publicKey = certificate.GetRSAPublicKey();

        Assert.Equal("hubit-zsgp-ru-tls-2026-04", DesktopUpdateTrust.KeyId);
        Assert.Equal(
            "0A9CFEF49EB1E11819D81A351978BAFA05EF7CBE",
            certificate.Thumbprint);
        Assert.Contains("CN=*.zsgp.ru", certificate.Subject, StringComparison.Ordinal);
        Assert.Contains("GlobalSign RSA OV SSL CA 2018", certificate.Issuer, StringComparison.Ordinal);
        Assert.False(certificate.HasPrivateKey);
        Assert.NotNull(publicKey);
        Assert.Equal(2048, publicKey.KeySize);
    }

    [Fact]
    public void AcceptsSignedStrictStableManifest()
    {
        using var rsa = RSA.Create(3072);
        var (json, publicKey) = CreateSignedManifest(rsa);

        var parsed = DesktopUpdateManifestVerifier.TryParse(
            json,
            HubBaseUri,
            out var manifest,
            out var error);

        Assert.True(parsed, error);
        Assert.True(DesktopUpdateManifestVerifier.VerifySignature(manifest, publicKey));
        Assert.True(DesktopUpdateManifestVerifier.IsNewerThan(manifest, new Version(0, 1, 6)));
        Assert.Equal(
            "https://hubit.zsgp.ru/desktop-updates/stable/0.1.7/HUB-Desktop-Setup-0.1.7-win-x64.exe",
            manifest.DownloadUri.AbsoluteUri);
    }

    [Theory]
    [InlineData("0.1.7", false)]
    [InlineData("0.1.8", false)]
    [InlineData("0.1.6", true)]
    public void ComparesOnlyStrictlyNewerVersions(string currentVersion, bool expected)
    {
        using var rsa = RSA.Create(3072);
        var (json, _) = CreateSignedManifest(rsa);
        Assert.True(DesktopUpdateManifestVerifier.TryParse(
            json,
            HubBaseUri,
            out var manifest,
            out _));

        Assert.Equal(
            expected,
            DesktopUpdateManifestVerifier.IsNewerThan(
                manifest,
                Version.Parse(currentVersion)));
    }

    [Fact]
    public void RejectsAdditionalManifestProperties()
    {
        using var rsa = RSA.Create(3072);
        var (json, _) = CreateSignedManifest(rsa, root => root["unexpected"] = true);

        Assert.False(DesktopUpdateManifestVerifier.TryParse(
            json,
            HubBaseUri,
            out _,
            out var error));
        Assert.Equal("manifest_schema", error);
    }

    [Theory]
    [InlineData("beta/0.1.7/HUB-Desktop-Setup-0.1.7-win-x64.exe")]
    [InlineData("stable/0.1.7/../../malware.exe")]
    [InlineData("https://example.com/malware.exe")]
    [InlineData("stable/0.1.8/HUB-Desktop-Setup-0.1.8-win-x64.exe")]
    public void RejectsUnsafeOrMismatchedPaths(string relativePath)
    {
        using var rsa = RSA.Create(3072);
        var (json, _) = CreateSignedManifest(
            rsa,
            root => root["relative_path"] = relativePath);

        Assert.False(DesktopUpdateManifestVerifier.TryParse(
            json,
            HubBaseUri,
            out _,
            out var error));
        Assert.Equal("relative_path", error);
    }

    [Fact]
    public void RejectsTamperedSignedFields()
    {
        using var rsa = RSA.Create(3072);
        var (json, publicKey) = CreateSignedManifest(rsa);
        var root = JsonSerializer.Deserialize<Dictionary<string, object>>(json)!;
        root["size_bytes"] = 124L;
        var tamperedJson = JsonSerializer.SerializeToUtf8Bytes(root);

        Assert.True(DesktopUpdateManifestVerifier.TryParse(
            tamperedJson,
            HubBaseUri,
            out var manifest,
            out var error), error);
        Assert.False(DesktopUpdateManifestVerifier.VerifySignature(manifest, publicKey));
    }

    [Fact]
    public void RejectsSignatureFromDifferentKey()
    {
        using var signingKey = RSA.Create(3072);
        using var differentKey = RSA.Create(3072);
        var (json, _) = CreateSignedManifest(signingKey);
        Assert.True(DesktopUpdateManifestVerifier.TryParse(
            json,
            HubBaseUri,
            out var manifest,
            out var error), error);

        Assert.False(DesktopUpdateManifestVerifier.VerifySignature(
            manifest,
            differentKey.ExportSubjectPublicKeyInfoPem()));
    }

    [Theory]
    [InlineData("{")]
    [InlineData("null")]
    [InlineData("[]")]
    public void RejectsMalformedOrNonObjectManifest(string json)
    {
        Assert.False(DesktopUpdateManifestVerifier.TryParse(
            System.Text.Encoding.UTF8.GetBytes(json),
            HubBaseUri,
            out _,
            out _));
    }

    [Fact]
    public async Task VerifiesDownloadedFileSizeAndSha256()
    {
        var path = Path.GetTempFileName();
        try
        {
            await File.WriteAllTextAsync(path, "trusted setup bytes");
            var bytes = await File.ReadAllBytesAsync(path);
            var manifest = CreateManifest(
                sizeBytes: bytes.Length,
                sha256: Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant());

            Assert.True(await DesktopUpdateManifestVerifier.VerifyFileAsync(manifest, path));

            await File.AppendAllTextAsync(path, "tampered");
            Assert.False(await DesktopUpdateManifestVerifier.VerifyFileAsync(manifest, path));
        }
        finally
        {
            File.Delete(path);
        }
    }

    private static (byte[] Json, string PublicKey) CreateSignedManifest(
        RSA rsa,
        Action<Dictionary<string, object>>? mutateAfterSigning = null)
    {
        var manifest = CreateManifest();
        var signature = Convert.ToBase64String(rsa.SignData(
            DesktopUpdateManifestVerifier.CreateCanonicalPayload(manifest),
            HashAlgorithmName.SHA256,
            RSASignaturePadding.Pss));
        var root = new Dictionary<string, object>
        {
            ["schema_version"] = manifest.SchemaVersion,
            ["channel"] = manifest.Channel,
            ["version"] = DesktopUpdateManifestVerifier.FormatVersion(manifest.Version),
            ["published_at"] = "2026-08-11T12:00:00Z",
            ["relative_path"] = manifest.RelativePath,
            ["size_bytes"] = manifest.SizeBytes,
            ["sha256"] = manifest.Sha256,
            ["release_notes"] = manifest.ReleaseNotes,
            ["signature"] = new Dictionary<string, object>
            {
                ["algorithm"] = manifest.Signature.Algorithm,
                ["key_id"] = manifest.Signature.KeyId,
                ["value"] = signature,
            },
        };
        mutateAfterSigning?.Invoke(root);
        return (
            JsonSerializer.SerializeToUtf8Bytes(root),
            rsa.ExportSubjectPublicKeyInfoPem());
    }

    private static DesktopUpdateManifest CreateManifest(
        long sizeBytes = 123,
        string sha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") =>
        new(
            DesktopUpdateManifestVerifier.SchemaVersion,
            DesktopUpdateManifestVerifier.StableChannel,
            new Version(0, 1, 7),
            new DateTimeOffset(2026, 8, 11, 12, 0, 0, TimeSpan.Zero),
            "stable/0.1.7/HUB-Desktop-Setup-0.1.7-win-x64.exe",
            new Uri(
                "https://hubit.zsgp.ru/desktop-updates/stable/0.1.7/" +
                "HUB-Desktop-Setup-0.1.7-win-x64.exe"),
            sizeBytes,
            sha256,
            ["Автоматическое обновление"],
            new DesktopUpdateSignature(
                DesktopUpdateManifestVerifier.SignatureAlgorithm,
                DesktopUpdateTrust.KeyId,
                "placeholder"));
}
