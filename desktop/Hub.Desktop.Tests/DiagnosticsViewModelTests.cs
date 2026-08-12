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
            1,
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
            "C:\\Logs");

        var model = new DiagnosticsViewModel(snapshot);

        Assert.True(model.HasRenderingWarning);
        Assert.Contains("программ", model.RenderingWarning, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(model.Items, item =>
            item.Label == "Профиль WebView2" && item.Value == "1 МБ");
        Assert.DoesNotContain(
            "?",
            string.Join("\n", model.Items.Select(item => item.Value)));
    }
}
