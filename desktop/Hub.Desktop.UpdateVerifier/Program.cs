using System.Text.Json;
using Hub.Desktop.UpdateCore;

namespace Hub.Desktop.UpdateVerifier;

internal static class Program
{
    private static readonly Uri HubBaseUri = new("https://hubit.zsgp.ru/");

    private static async Task<int> Main(string[] args)
    {
        if (!TryParseArguments(args, out var manifestPath, out var setupPath))
        {
            Console.Error.WriteLine(
                "Usage: HUB.Desktop.UpdateVerifier --manifest <latest.json> --setup <Setup.exe>");
            return 2;
        }

        try
        {
            var manifestFile = new FileInfo(manifestPath);
            if (!manifestFile.Exists
                || manifestFile.Length <= 0
                || manifestFile.Length > DesktopUpdateManifestVerifier.MaximumManifestBytes)
            {
                Console.Error.WriteLine("Manifest file is missing or outside the allowed size.");
                return 3;
            }

            var manifestBytes = await File.ReadAllBytesAsync(manifestFile.FullName);
            if (!DesktopUpdateManifestVerifier.TryParse(
                    manifestBytes,
                    HubBaseUri,
                    out var manifest,
                    out var parseError))
            {
                Console.Error.WriteLine($"Manifest rejected: {parseError}");
                return 4;
            }

            using var certificate = DesktopUpdateTrust.LoadCertificate();
            if (!DesktopUpdateManifestVerifier.VerifySignature(manifest, certificate))
            {
                Console.Error.WriteLine("Manifest signature is invalid or uses an untrusted key id.");
                return 5;
            }

            if (!await DesktopUpdateManifestVerifier.VerifyFileAsync(manifest, setupPath))
            {
                Console.Error.WriteLine("Setup size or SHA-256 does not match the signed manifest.");
                return 6;
            }

            Console.WriteLine(JsonSerializer.Serialize(new
            {
                valid = true,
                version = DesktopUpdateManifestVerifier.FormatVersion(manifest.Version),
                channel = manifest.Channel,
                key_id = manifest.Signature.KeyId,
                setup = Path.GetFileName(setupPath),
                size_bytes = manifest.SizeBytes,
                sha256 = manifest.Sha256,
            }));
            return 0;
        }
        catch (Exception exception) when (
            exception is IOException
                or UnauthorizedAccessException
                or ArgumentException)
        {
            Console.Error.WriteLine($"Verification failed: {exception.GetType().Name}");
            return 1;
        }
    }

    private static bool TryParseArguments(
        string[] args,
        out string manifestPath,
        out string setupPath)
    {
        manifestPath = string.Empty;
        setupPath = string.Empty;
        if (args.Length != 4)
        {
            return false;
        }

        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var index = 0; index < args.Length; index += 2)
        {
            if (!args[index].StartsWith("--", StringComparison.Ordinal)
                || string.IsNullOrWhiteSpace(args[index + 1])
                || !values.TryAdd(args[index], args[index + 1]))
            {
                return false;
            }
        }

        if (values.Count != 2
            || !values.TryGetValue("--manifest", out var parsedManifestPath)
            || !values.TryGetValue("--setup", out var parsedSetupPath)
            || string.IsNullOrWhiteSpace(parsedManifestPath)
            || string.IsNullOrWhiteSpace(parsedSetupPath))
        {
            return false;
        }

        manifestPath = Path.GetFullPath(parsedManifestPath);
        setupPath = Path.GetFullPath(parsedSetupPath);
        return true;
    }
}
