using Hub.Desktop.Diagnostics;
using Hub.Desktop.Updates;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopDiagnosticsCollectorTests
{
    [Fact]
    public void ProducesBoundedSnapshotWithoutOriginQueryOrSecrets()
    {
        var environment = new DesktopMachineInfo(
            DesktopVersion: "0.1.9",
            InstallPath: "C:\\Program Files\\HUB-IT\\HUB Desktop\\HUB.Desktop.exe",
            WindowsDescription: "Windows 11 Enterprise",
            WindowsVersion: "10.0.22631",
            ProcessArchitecture: "X64",
            IsElevated: false,
            WebView2Version: "123.0.1",
            WpfRenderTier: 2,
            UpdateFreeSpaceBytes: 50_000_000_000,
            WebViewProfileBytes: 120_000_000,
            UpdateCacheBytes: 200_000_000);
        var collector = new DesktopDiagnosticsCollector(
            () => new DateTimeOffset(2026, 8, 11, 12, 0, 0, TimeSpan.Zero),
            () => environment);
        var context = new DesktopDiagnosticsContext(
            new Uri("https://user:secret@hubit.zsgp.ru/path?token=secret#fragment"),
            WindowsAppSdkStatus: "Доступен",
            NotificationMode: "Fallback",
            AutostartStatus: "Включён",
            LastNavigationStatus: "Success",
            LastNavigationAtUtc: new DateTimeOffset(2026, 8, 11, 11, 59, 0, TimeSpan.Zero),
            LastBridgeHandshakeUtc: new DateTimeOffset(2026, 8, 11, 11, 59, 5, TimeSpan.Zero),
            UpdateState: new DesktopUpdateState(DesktopUpdateStatus.Downloading,
                new Version(0, 1, 9), 50, 100));

        var snapshot = collector.Collect(context);

        Assert.Equal("https://hubit.zsgp.ru", snapshot.ConfiguredOrigin);
        Assert.Equal("Downloading (50%)", snapshot.UpdaterStatus);
        Assert.Equal(2, snapshot.WpfRenderTier);
        Assert.False(snapshot.SoftwareRendering);
        Assert.DoesNotContain(
            "secret",
            System.Text.Json.JsonSerializer.Serialize(snapshot),
            StringComparison.OrdinalIgnoreCase);
    }
}
