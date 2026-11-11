using Hub.Desktop.Diagnostics;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopMemoryMetricsTests
{
    [Fact]
    public void AggregatesProcessKindsAndIgnoresExitedProcesses()
    {
        var readings = new Dictionary<int, DesktopProcessMemoryReading?>
        {
            [1] = new(100, 120),
            [2] = new(200, 240),
            [3] = new(300, 360),
            [4] = null,
        };
        var sampler = new DesktopMemorySampler(processId => readings.GetValueOrDefault(processId));

        var sample = sampler.Capture(
            new DateTimeOffset(2026, 8, 12, 12, 0, 0, TimeSpan.Zero),
            "https://hubit.zsgp.ru/chat?conversation=secret#message",
            background: false,
            [
                new(1, DesktopMemoryProcessKind.Host),
                new(2, DesktopMemoryProcessKind.Browser),
                new(3, DesktopMemoryProcessKind.Renderer),
                new(3, DesktopMemoryProcessKind.Renderer),
                new(4, DesktopMemoryProcessKind.Gpu),
            ]);

        Assert.NotNull(sample);
        Assert.Equal("/chat", sample.Route);
        Assert.Equal(3, sample.ProcessCount);
        Assert.Equal(600, sample.Total.PrivateBytes);
        Assert.Equal(500, sample.WebViewPrivateBytes);
        Assert.Equal(300, sample.Renderer.PrivateBytes);
    }

    [Fact]
    public void CalculatesP95ByWindowModeAndRoute()
    {
        var now = new DateTimeOffset(2026, 8, 12, 12, 30, 0, TimeSpan.Zero);
        var metrics = new DesktopMemoryMetrics(() => now);
        for (var index = 1; index <= 20; index++)
        {
            metrics.Record(CreateSample(
                now.AddMinutes(-10).AddSeconds(index),
                index * 100,
                background: false,
                route: "/chat"));
        }
        metrics.Record(CreateSample(now.AddMinutes(-1), 500, background: true, route: "/mail"));
        metrics.Record(CreateSample(now, 700, background: true, route: "/mail"));

        var snapshot = metrics.Snapshot();

        Assert.Equal(1900, snapshot.Active?.P95PrivateBytes);
        Assert.Equal(2000, snapshot.Active?.MaxPrivateBytes);
        Assert.Equal(700, snapshot.Background?.P95PrivateBytes);
        Assert.Equal(700, snapshot.Current?.Total.PrivateBytes);
        Assert.Equal(2, snapshot.Routes.Count);
        var chat = Assert.Single(snapshot.Routes, route => !route.Background);
        Assert.Equal("/chat", chat.Route);
        Assert.Equal(1900, chat.P95PrivateBytes);
        var mail = Assert.Single(snapshot.Routes, route => route.Background);
        Assert.Equal("/mail", mail.Route);
        Assert.Equal(700, mail.P95PrivateBytes);
    }

    [Fact]
    public void KeepsOnlyThirtyMinutesAndOneHundredEightySamples()
    {
        var now = new DateTimeOffset(2026, 8, 12, 12, 30, 0, TimeSpan.Zero);
        var metrics = new DesktopMemoryMetrics(() => now);
        metrics.Record(CreateSample(now.AddMinutes(-31), 1, false, "/chat"));
        for (var index = 0; index < 200; index++)
        {
            metrics.Record(CreateSample(now.AddSeconds(index - 200), index + 10, false, "/chat"));
        }

        var snapshot = metrics.Snapshot();

        Assert.Equal(DesktopMemoryMetrics.MaximumSamples, snapshot.Active?.SampleCount);
        Assert.Equal(209, snapshot.Active?.MaxPrivateBytes);
    }

    [Theory]
    [InlineData("https://hubit.zsgp.ru/networks/42?token=secret", "/networks")]
    [InlineData("/dashboard/news?post=42", "/dashboard")]
    [InlineData("https://hubit.zsgp.ru/customer-secret", "/other")]
    public void ClassifiesOnlyKnownRouteSections(string source, string expected)
    {
        Assert.Equal(expected, DesktopMemoryRouteClassifier.Classify(source));
    }

    private static DesktopMemorySample CreateSample(
        DateTimeOffset recordedAt,
        long privateBytes,
        bool background,
        string route)
    {
        var zero = new DesktopMemoryProcessTotals(0, 0);
        var total = new DesktopMemoryProcessTotals(privateBytes, privateBytes + 50);
        return new DesktopMemorySample(
            recordedAt,
            route,
            background,
            1,
            total,
            zero,
            zero,
            zero,
            zero,
            zero,
            total);
    }
}
