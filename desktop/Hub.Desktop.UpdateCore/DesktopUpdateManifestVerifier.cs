using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Security.Cryptography.X509Certificates;

namespace Hub.Desktop.UpdateCore;

public static partial class DesktopUpdateManifestVerifier
{
    public const int SchemaVersion = 1;
    public const int MaximumManifestBytes = 32 * 1024;
    public const long MaximumSetupBytes = 500L * 1024 * 1024;
    public const string StableChannel = "stable";
    public const string SignatureAlgorithm = "RSA-PSS-SHA256";

    private const int MaximumReleaseNotes = 10;
    private const int MaximumReleaseNoteLength = 200;
    private const int MaximumRelativePathLength = 512;
    private const int MaximumKeyIdLength = 64;
    private const int MaximumSignatureLength = 2048;

    public static bool TryParse(
        ReadOnlySpan<byte> json,
        Uri hubBaseUri,
        out DesktopUpdateManifest manifest,
        out string error)
    {
        manifest = default!;
        error = string.Empty;

        if (json.IsEmpty || json.Length > MaximumManifestBytes)
        {
            error = "manifest_size";
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(json.ToArray());
            var root = document.RootElement;
            if (!HasExactProperties(
                    root,
                    "schema_version",
                    "channel",
                    "version",
                    "published_at",
                    "relative_path",
                    "size_bytes",
                    "sha256",
                    "release_notes",
                    "signature"))
            {
                error = "manifest_schema";
                return false;
            }

            if (!root.TryGetProperty("schema_version", out var schemaElement)
                || !schemaElement.TryGetInt32(out var schemaVersion)
                || schemaVersion != SchemaVersion)
            {
                error = "schema_version";
                return false;
            }

            if (!TryGetBoundedString(root, "channel", StableChannel.Length, out var channel)
                || !string.Equals(channel, StableChannel, StringComparison.Ordinal))
            {
                error = "channel";
                return false;
            }

            if (!TryGetBoundedString(root, "version", 32, out var versionText)
                || !VersionPattern().IsMatch(versionText)
                || !Version.TryParse(versionText, out var version))
            {
                error = "version";
                return false;
            }

            if (!TryGetBoundedString(root, "published_at", 32, out var publishedAtText)
                || !DateTimeOffset.TryParseExact(
                    publishedAtText,
                    "yyyy-MM-dd'T'HH:mm:ss'Z'",
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                    out var publishedAt))
            {
                error = "published_at";
                return false;
            }

            if (!TryGetBoundedString(
                    root,
                    "relative_path",
                    MaximumRelativePathLength,
                    out var relativePath)
                || !TryBuildDownloadUri(hubBaseUri, versionText, relativePath, out var downloadUri))
            {
                error = "relative_path";
                return false;
            }

            if (!root.TryGetProperty("size_bytes", out var sizeElement)
                || !sizeElement.TryGetInt64(out var sizeBytes)
                || sizeBytes <= 0
                || sizeBytes > MaximumSetupBytes)
            {
                error = "size_bytes";
                return false;
            }

            if (!TryGetBoundedString(root, "sha256", 64, out var sha256)
                || !Sha256Pattern().IsMatch(sha256))
            {
                error = "sha256";
                return false;
            }

            if (!TryGetReleaseNotes(root, out var releaseNotes))
            {
                error = "release_notes";
                return false;
            }

            if (!TryGetSignature(root, out var signature))
            {
                error = "signature";
                return false;
            }

            manifest = new DesktopUpdateManifest(
                schemaVersion,
                channel,
                version,
                publishedAt,
                relativePath,
                downloadUri,
                sizeBytes,
                sha256.ToLowerInvariant(),
                releaseNotes,
                signature);
            return true;
        }
        catch (JsonException)
        {
            error = "manifest_json";
            return false;
        }
    }

    public static bool IsNewerThan(DesktopUpdateManifest manifest, Version currentVersion) =>
        manifest.Version > NormalizeVersion(currentVersion);

    public static bool VerifySignature(DesktopUpdateManifest manifest, string publicKeyPem)
    {
        try
        {
            using var rsa = RSA.Create();
            rsa.ImportFromPem(publicKeyPem);
            var signature = Convert.FromBase64String(manifest.Signature.Value);
            return rsa.VerifyData(
                CreateCanonicalPayload(manifest),
                signature,
                HashAlgorithmName.SHA256,
                RSASignaturePadding.Pss);
        }
        catch (Exception exception) when (
            exception is ArgumentException
                or CryptographicException
                or FormatException)
        {
            return false;
        }
    }

    public static bool VerifySignature(
        DesktopUpdateManifest manifest,
        X509Certificate2 certificate)
    {
        if (!string.Equals(
                manifest.Signature.KeyId,
                DesktopUpdateTrust.KeyId,
                StringComparison.Ordinal))
        {
            return false;
        }

        using var rsa = certificate.GetRSAPublicKey();
        if (rsa is null)
        {
            return false;
        }

        try
        {
            return rsa.VerifyData(
                CreateCanonicalPayload(manifest),
                Convert.FromBase64String(manifest.Signature.Value),
                HashAlgorithmName.SHA256,
                RSASignaturePadding.Pss);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    public static byte[] CreateCanonicalPayload(DesktopUpdateManifest manifest)
    {
        var notesHash = Convert.ToHexString(
            SHA256.HashData(Encoding.UTF8.GetBytes(string.Join('\n', manifest.ReleaseNotes))))
            .ToLowerInvariant();
        var canonical = string.Join(
            '\n',
            "hub-desktop-update-v1",
            manifest.Channel,
            FormatVersion(manifest.Version),
            manifest.PublishedAt.UtcDateTime.ToString(
                "yyyy-MM-dd'T'HH:mm:ss'Z'",
                CultureInfo.InvariantCulture),
            manifest.RelativePath,
            manifest.SizeBytes.ToString(CultureInfo.InvariantCulture),
            manifest.Sha256.ToLowerInvariant(),
            notesHash,
            manifest.Signature.Algorithm,
            manifest.Signature.KeyId);
        return Encoding.UTF8.GetBytes(canonical);
    }

    public static async Task<bool> VerifyFileAsync(
        DesktopUpdateManifest manifest,
        string path,
        CancellationToken cancellationToken = default)
    {
        var file = new FileInfo(path);
        if (!file.Exists || file.Length != manifest.SizeBytes)
        {
            return false;
        }

        await using var stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: 128 * 1024,
            useAsync: true);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return string.Equals(
            Convert.ToHexString(hash).ToLowerInvariant(),
            manifest.Sha256,
            StringComparison.Ordinal);
    }

    public static string FormatVersion(Version version) =>
        $"{version.Major}.{version.Minor}.{Math.Max(0, version.Build)}";

    private static Version NormalizeVersion(Version version) =>
        new(version.Major, version.Minor, Math.Max(0, version.Build));

    private static bool TryBuildDownloadUri(
        Uri hubBaseUri,
        string version,
        string relativePath,
        out Uri downloadUri)
    {
        downloadUri = default!;
        if (!hubBaseUri.IsAbsoluteUri
            || !hubBaseUri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            || hubBaseUri.AbsolutePath != "/"
            || relativePath.Contains('\\', StringComparison.Ordinal)
            || relativePath.Contains("..", StringComparison.Ordinal)
            || !RelativePathPattern().IsMatch(relativePath))
        {
            return false;
        }

        var match = RelativePathPattern().Match(relativePath);
        if (!string.Equals(match.Groups["version"].Value, version, StringComparison.Ordinal))
        {
            return false;
        }

        var updateRoot = new Uri(hubBaseUri, "desktop-updates/");
        var candidate = new Uri(updateRoot, relativePath);
        if (!candidate.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            || !candidate.Host.Equals(hubBaseUri.Host, StringComparison.OrdinalIgnoreCase)
            || candidate.Port != hubBaseUri.Port
            || !candidate.AbsolutePath.StartsWith(
                "/desktop-updates/stable/",
                StringComparison.Ordinal))
        {
            return false;
        }

        downloadUri = candidate;
        return true;
    }

    private static bool TryGetReleaseNotes(
        JsonElement root,
        out IReadOnlyList<string> releaseNotes)
    {
        releaseNotes = Array.Empty<string>();
        if (!root.TryGetProperty("release_notes", out var notesElement)
            || notesElement.ValueKind != JsonValueKind.Array
            || notesElement.GetArrayLength() > MaximumReleaseNotes)
        {
            return false;
        }

        var notes = new List<string>();
        foreach (var element in notesElement.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.String)
            {
                return false;
            }

            var note = element.GetString() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(note)
                || note.Length > MaximumReleaseNoteLength
                || note.Any(char.IsControl))
            {
                return false;
            }

            notes.Add(note);
        }

        releaseNotes = notes;
        return true;
    }

    private static bool TryGetSignature(
        JsonElement root,
        out DesktopUpdateSignature signature)
    {
        signature = default!;
        if (!root.TryGetProperty("signature", out var signatureElement)
            || !HasExactProperties(signatureElement, "algorithm", "key_id", "value")
            || !TryGetBoundedString(
                signatureElement,
                "algorithm",
                SignatureAlgorithm.Length,
                out var algorithm)
            || !string.Equals(algorithm, SignatureAlgorithm, StringComparison.Ordinal)
            || !TryGetBoundedString(
                signatureElement,
                "key_id",
                MaximumKeyIdLength,
                out var keyId)
            || !KeyIdPattern().IsMatch(keyId)
            || !TryGetBoundedString(
                signatureElement,
                "value",
                MaximumSignatureLength,
                out var value))
        {
            return false;
        }

        try
        {
            _ = Convert.FromBase64String(value);
        }
        catch (FormatException)
        {
            return false;
        }

        signature = new DesktopUpdateSignature(algorithm, keyId, value);
        return true;
    }

    private static bool TryGetBoundedString(
        JsonElement root,
        string propertyName,
        int maximumLength,
        out string value)
    {
        value = string.Empty;
        if (!root.TryGetProperty(propertyName, out var element)
            || element.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        value = element.GetString() ?? string.Empty;
        return !string.IsNullOrWhiteSpace(value)
            && value.Length <= maximumLength
            && !value.Any(char.IsControl);
    }

    private static bool HasExactProperties(JsonElement element, params string[] names)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        var expected = new HashSet<string>(names, StringComparer.Ordinal);
        var count = 0;
        foreach (var property in element.EnumerateObject())
        {
            count++;
            if (!expected.Contains(property.Name))
            {
                return false;
            }
        }

        return count == expected.Count;
    }

    [GeneratedRegex("^[0-9]+\\.[0-9]+\\.[0-9]+$", RegexOptions.CultureInvariant)]
    private static partial Regex VersionPattern();

    [GeneratedRegex("^[0-9a-fA-F]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex Sha256Pattern();

    [GeneratedRegex("^[A-Za-z0-9._-]{1,64}$", RegexOptions.CultureInvariant)]
    private static partial Regex KeyIdPattern();

    [GeneratedRegex(
        "^stable/(?<version>[0-9]+\\.[0-9]+\\.[0-9]+)/HUB-Desktop-Setup-[0-9]+\\.[0-9]+\\.[0-9]+-win-x64\\.exe$",
        RegexOptions.CultureInvariant)]
    private static partial Regex RelativePathPattern();
}
