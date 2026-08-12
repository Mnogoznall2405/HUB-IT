using System.IO;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using Hub.Desktop.Configuration;

namespace Hub.Desktop.Diagnostics;

public sealed class DesktopSupportBundleExporter
{
    private const int MaximumLogFiles = 6;
    private const int MaximumLogBytes = 2 * 1024 * 1024;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        WriteIndented = true,
    };
    private readonly string _logsFolder;

    public DesktopSupportBundleExporter(string? logsFolder = null)
    {
        _logsFolder = Path.GetFullPath(logsFolder ?? DesktopPaths.LogsFolder);
    }

    public void Export(string destinationPath, DesktopDiagnosticsSnapshot snapshot)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(destinationPath);
        ArgumentNullException.ThrowIfNull(snapshot);
        var destination = Path.GetFullPath(destinationPath);
        var directory = Path.GetDirectoryName(destination)
            ?? throw new InvalidOperationException("Support bundle path has no directory.");
        Directory.CreateDirectory(directory);
        var temporaryPath = destination + ".partial";

        try
        {
            if (File.Exists(temporaryPath))
            {
                File.Delete(temporaryPath);
            }

            using (var stream = new FileStream(
                       temporaryPath,
                       FileMode.CreateNew,
                       FileAccess.ReadWrite,
                       FileShare.None))
            using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: false))
            {
                WriteTextEntry(
                    archive,
                    "diagnostics.json",
                    DesktopRedaction.Redact(JsonSerializer.Serialize(snapshot, JsonOptions)));
                WriteTextEntry(
                    archive,
                    "self-checks.json",
                    JsonSerializer.Serialize(CreateSelfChecks(snapshot), JsonOptions));
                AddLogs(archive);
            }

            File.Move(temporaryPath, destination, overwrite: true);
        }
        catch
        {
            if (File.Exists(temporaryPath))
            {
                File.Delete(temporaryPath);
            }

            throw;
        }
    }

    private void AddLogs(ZipArchive archive)
    {
        if (!Directory.Exists(_logsFolder))
        {
            return;
        }

        foreach (var path in Directory.EnumerateFiles(
                     _logsFolder,
                     "hub-desktop.log*",
                     SearchOption.TopDirectoryOnly)
                 .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
                 .Take(MaximumLogFiles))
        {
            var info = new FileInfo(path);
            if ((info.Attributes & FileAttributes.ReparsePoint) != 0)
            {
                continue;
            }

            var content = ReadBoundedText(path);
            WriteTextEntry(
                archive,
                "logs/" + Path.GetFileName(path),
                DesktopRedaction.Redact(content));
        }
    }

    private static string ReadBoundedText(string path)
    {
        using var stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete);
        var length = (int)Math.Min(stream.Length, MaximumLogBytes);
        var buffer = new byte[length];
        var total = 0;
        while (total < buffer.Length)
        {
            var read = stream.Read(buffer, total, buffer.Length - total);
            if (read == 0)
            {
                break;
            }

            total += read;
        }

        return Encoding.UTF8.GetString(buffer, 0, total);
    }

    private static void WriteTextEntry(
        ZipArchive archive,
        string name,
        string content)
    {
        var entry = archive.CreateEntry(name, CompressionLevel.Optimal);
        using var writer = new StreamWriter(
            entry.Open(),
            new UTF8Encoding(false));
        writer.Write(content);
    }

    private static object CreateSelfChecks(DesktopDiagnosticsSnapshot snapshot) => new
    {
        schema_version = 1,
        origin_uses_https = Uri.TryCreate(
            snapshot.ConfiguredOrigin,
            UriKind.Absolute,
            out var origin)
            && origin.Scheme == Uri.UriSchemeHttps,
        webview2_runtime_available = !string.Equals(
            snapshot.WebView2Version,
            "Недоступен",
            StringComparison.OrdinalIgnoreCase),
        update_volume_has_reserve = snapshot.UpdateFreeSpaceBytes is > 100L * 1024 * 1024,
        hardware_rendering = !snapshot.SoftwareRendering,
        log_folder_available = Directory.Exists(snapshot.LogsFolder),
    };
}
