using Hub.Desktop.Diagnostics;
using Hub.Desktop.ViewModels;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DiagnosticsViewModelTests
{
    [Fact]
    public void ExplainsSoftwareRenderingAndFormatsBoundedValues()
    {
        var snapshot = new DesktopDiagnosticsSnapshot(
            2,
            DateTimeOffset.UtcNow,
            "0.1.9",
            "C:\\HUB.Desktop.exe",
            "Windows 11",
            "10.0.22631",
            "X64",
            false,
            "123.0",
            "Доступен",
            0,
            true,
            "https://hubit.zsgp.ru",
            "Success",
            null,
            null,
            "Fallback",
            "Включён",
            "Idle",
            10_000_000,
            1_048_576,
            2_097_152,
            "C:\\Logs",
            Memory: new DesktopMemorySnapshot(
                Current: CreateMemorySample(600 * 1024 * 1024L),
                Active: new DesktopMemoryWindowSummary(
                    10,
                    600 * 1024 * 1024L,
                    610 * 1024 * 1024L,
                    620 * 1024 * 1024L,
                    700 * 1024 * 1024L,
                    710 * 1024 * 1024L,
                    720 * 1024 * 1024L),
                Background: new DesktopMemoryWindowSummary(
                    10,
                    300 * 1024 * 1024L,
                    310 * 1024 * 1024L,
                    320 * 1024 * 1024L,
                    400 * 1024 * 1024L,
                    410 * 1024 * 1024L,
                    420 * 1024 * 1024L),
                Routes: []));

        var model = new DiagnosticsViewModel(snapshot);

        Assert.True(model.HasRenderingWarning);
        Assert.Contains("программ", model.RenderingWarning, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(model.Items, item =>
            item.Label == "Профиль WebView2" && item.Value == "1 МБ");
        Assert.Contains(model.Items, item =>
            item.Label == "Память сейчас" && item.Value == "600 МБ");
        Assert.Contains(model.Items, item =>
            item.Label == "WebView2 renderer" && item.Value == "500 МБ");
        Assert.Contains(model.Items, item =>
            item.Label == "Память active max" && item.Value == "620 МБ");
        Assert.DoesNotContain(
            "?",
            string.Join("\n", model.Items.Select(item => item.Value)));
    }

    private static DesktopMemorySample CreateMemorySample(long privateBytes)
    {
        var host = new DesktopMemoryProcessTotals(100 * 1024 * 1024L, 120 * 1024 * 1024L);
        var renderer = new DesktopMemoryProcessTotals(
            privateBytes - host.PrivateBytes,
            privateBytes - host.WorkingSetBytes);
        var zero = new DesktopMemoryProcessTotals(0, 0);
        return new DesktopMemorySample(
            DateTimeOffset.UtcNow,
            "/chat",
            false,
            2,
            host,
            zero,
            renderer,
            zero,
            zero,
            zero,
            new DesktopMemoryProcessTotals(privateBytes, privateBytes));
    }
}
