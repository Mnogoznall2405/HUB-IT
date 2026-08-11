using System.Text;
using Hub.Desktop.UpdateCore;

namespace Hub.Desktop.UpdateRunner;

internal static class Program
{
    private static readonly TimeSpan ParentExitTimeout = TimeSpan.FromSeconds(30);

    private static async Task<int> Main(string[] args)
    {
        var options = RunnerOptions.TryParse(args);
        if (options is null)
        {
            return 2;
        }

        try
        {
            if (!TryValidatePaths(options, out var error))
            {
                WriteLog($"Rejected update runner paths; error={error}");
                return 3;
            }

            var manifestBytes = await File.ReadAllBytesAsync(options.ManifestPath);
            if (!DesktopUpdateManifestVerifier.TryParse(
                    manifestBytes,
                    new Uri("https://hubit.zsgp.ru/"),
                    out var manifest,
                    out error))
            {
                WriteLog($"Rejected update manifest; error={error}");
                return 4;
            }

            using var certificate = DesktopUpdateTrust.LoadCertificate();
            if (!DesktopUpdateManifestVerifier.VerifySignature(manifest, certificate)
                || !await DesktopUpdateManifestVerifier.VerifyFileAsync(
                    manifest,
                    options.SetupPath))
            {
                WriteLog("Rejected update package verification");
                return 5;
            }

            return await UpdateRunnerWorkflow.ExecuteAsync(
                options.ParentProcessId,
                options.SetupPath,
                options.ApplicationPath,
                new SystemUpdateRunnerPlatform(ParentExitTimeout),
                WriteLog);
        }
        catch (Exception exception)
        {
            WriteLog($"Update runner failed; exception={exception.GetType().Name}");
            return 1;
        }
    }

    private static bool TryValidatePaths(RunnerOptions options, out string error)
    {
        error = string.Empty;
        var updateRoot = Path.GetFullPath(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "HUB-IT",
            "Desktop",
            "Updates"));
        var setupPath = Path.GetFullPath(options.SetupPath);
        var manifestPath = Path.GetFullPath(options.ManifestPath);
        var rootPrefix = updateRoot.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;

        if (!setupPath.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase)
            || !manifestPath.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase)
            || !File.Exists(setupPath)
            || !File.Exists(manifestPath))
        {
            error = "update_files";
            return false;
        }

        var applicationPath = Path.GetFullPath(options.ApplicationPath);
        if (!File.Exists(applicationPath)
            || !Path.GetFileName(applicationPath).Equals(
                "HUB.Desktop.exe",
                StringComparison.OrdinalIgnoreCase))
        {
            error = "application";
            return false;
        }

        return true;
    }

    private static void WriteLog(string message)
    {
        try
        {
            var folder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "HUB-IT",
                "Desktop",
                "Logs");
            Directory.CreateDirectory(folder);
            var logPath = Path.Combine(folder, "hub-desktop-update-runner.log");
            if (File.Exists(logPath) && new FileInfo(logPath).Length >= 1_048_576)
            {
                File.Move(logPath, logPath + ".1", true);
            }

            File.AppendAllText(
                logPath,
                $"{DateTimeOffset.Now:O} {message}{Environment.NewLine}",
                Encoding.UTF8);
        }
        catch
        {
            // Update logging must never block recovery.
        }
    }

    private sealed record RunnerOptions(
        int ParentProcessId,
        string SetupPath,
        string ManifestPath,
        string ApplicationPath)
    {
        public static RunnerOptions? TryParse(string[] args)
        {
            if (args.Length != 8)
            {
                return null;
            }

            var values = new Dictionary<string, string>(StringComparer.Ordinal);
            for (var index = 0; index < args.Length; index += 2)
            {
                if (!args[index].StartsWith("--", StringComparison.Ordinal)
                    || !values.TryAdd(args[index], args[index + 1]))
                {
                    return null;
                }
            }

            return values.Count == 4
                && int.TryParse(values.GetValueOrDefault("--parent-pid"), out var parentPid)
                && parentPid > 0
                && values.TryGetValue("--setup", out var setup)
                && values.TryGetValue("--manifest", out var manifest)
                && values.TryGetValue("--application", out var application)
                    ? new RunnerOptions(parentPid, setup, manifest, application)
                    : null;
        }
    }
}
