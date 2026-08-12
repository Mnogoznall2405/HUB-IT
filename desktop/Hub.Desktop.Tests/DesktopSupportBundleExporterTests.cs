using System.IO.Compression;
using Hub.Desktop.Diagnostics;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopSupportBundleExporterTests : IDisposable
{
    private readonly string _root = Path.Combine(
        Path.GetTempPath(),
        "hub-desktop-support-tests",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public void ExportsOnlyRedactedDiagnosticsAndRollingLogs()
    {
        var logs = Path.Combine(_root, "Logs");
        var webView = Path.Combine(_root, "WebView2");
        Directory.CreateDirectory(logs);
        Directory.CreateDirectory(webView);
        File.WriteAllText(
            Path.Combine(logs, "hub-desktop.log"),
            "Authorization: Bearer bearer-secret\n" +
            "https://hubit.zsgp.ru/chat?token=query-secret");
        File.WriteAllText(Path.Combine(logs, "unrelated.txt"), "document-secret");
        File.WriteAllText(Path.Combine(webView, "Cookies"), "cookie-secret");
        var destination = Path.Combine(_root, "support.zip");
        var snapshot = CreateSnapshot();
        var exporter = new DesktopSupportBundleExporter(logs);

        exporter.Export(destination, snapshot);

        using var archive = ZipFile.OpenRead(destination);
        var names = archive.Entries.Select(entry => entry.FullName).Order().ToArray();
        Assert.Equal(
            ["diagnostics.json", "logs/hub-desktop.log", "self-checks.json"],
            names);
        var contents = string.Join("\n", archive.Entries.Select(ReadEntry));
        Assert.DoesNotContain("bearer-secret", contents);
        Assert.DoesNotContain("query-secret", contents);
        Assert.DoesNotContain("document-secret", contents);
        Assert.DoesNotContain("cookie-secret", contents);
        Assert.DoesNotContain("?", contents);
        Assert.False(File.Exists(destination + ".partial"));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }

    private static DesktopDiagnosticsSnapshot CreateSnapshot() => new(
        SchemaVersion: 1,
        GeneratedAtUtc: new DateTimeOffset(2026, 8, 11, 12, 0, 0, TimeSpan.Zero),
        DesktopVersion: "0.1.9",
        InstallPath: "C:\\Program Files\\HUB-IT\\HUB Desktop\\HUB.Desktop.exe",
        WindowsDescription: "Windows 11 Enterprise",
        WindowsVersion: "10.0.22631",
        ProcessArchitecture: "X64",
        IsElevated: false,
        WebView2Version: "123.0.1",
        WindowsAppSdkStatus: "Доступен",
        WpfRenderTier: 2,
        SoftwareRendering: false,
        ConfiguredOrigin: "https://hubit.zsgp.ru",
        LastNavigationStatus: "Success",
        LastNavigationAtUtc: null,
        LastBridgeHandshakeUtc: null,
        NotificationMode: "Fallback",
        AutostartStatus: "Включён",
        UpdaterStatus: "Idle",
        UpdateFreeSpaceBytes: 10_000_000_000,
        WebViewProfileBytes: 100_000_000,
        UpdateCacheBytes: 20_000_000,
        LogsFolder: "C:\\Users\\user\\AppData\\Local\\HUB-IT\\Desktop\\Logs");

    private static string ReadEntry(ZipArchiveEntry entry)
    {
        using var reader = new StreamReader(entry.Open());
        return reader.ReadToEnd();
    }
}
