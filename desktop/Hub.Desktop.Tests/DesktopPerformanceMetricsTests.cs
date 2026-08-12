using Hub.Desktop.Diagnostics;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopPerformanceMetricsTests
{
    [Fact]
    public void MeasuresStartupBridgeStallsAndProcessFailures()
    {
        var startedAt = new DateTimeOffset(2026, 8, 11, 12, 0, 0, TimeSpan.Zero);
        var metrics = new DesktopPerformanceMetrics(startedAt);

        metrics.RecordUiPulse(startedAt.AddSeconds(1));
        metrics.RecordUiPulse(startedAt.AddSeconds(3));
        metrics.RecordWebViewInitialized(startedAt.AddSeconds(4));
        metrics.RecordBridgeReady(startedAt.AddSeconds(5.5));
        metrics.RecordWebViewProcessFailure();
        metrics.RecordWebViewProcessFailure();

        var snapshot = metrics.Snapshot();

        Assert.Equal(4000, snapshot.ProcessStartToWebViewMilliseconds);
        Assert.Equal(1500, snapshot.WebViewToBridgeMilliseconds);
        Assert.Equal(1, snapshot.UiThreadStallCount);
        Assert.Equal(2, snapshot.WebViewProcessFailureCount);
    }

    [Fact]
    public void RecordsFirstSuccessfulMilestoneOnly()
    {
        var startedAt = DateTimeOffset.UtcNow;
        var metrics = new DesktopPerformanceMetrics(startedAt);
        metrics.RecordWebViewInitialized(startedAt.AddSeconds(2));
        metrics.RecordWebViewInitialized(startedAt.AddSeconds(10));
        metrics.RecordBridgeReady(startedAt.AddSeconds(3));
        metrics.RecordBridgeReady(startedAt.AddSeconds(20));

        var snapshot = metrics.Snapshot();

        Assert.Equal(2000, snapshot.ProcessStartToWebViewMilliseconds);
        Assert.Equal(1000, snapshot.WebViewToBridgeMilliseconds);
    }
}
