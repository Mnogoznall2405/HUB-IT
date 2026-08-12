using Hub.Desktop.WebView;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class WebViewRecoveryPolicyTests
{
    [Fact]
    public void RecreatesWebViewImmediatelyAfterFirstBrowserFailure()
    {
        var policy = CreatePolicy();

        var decision = policy.Next(WebViewFailureKind.BrowserProcessExited);

        Assert.Equal(WebViewRecoveryAction.RecreateWebView, decision.Action);
        Assert.Equal(TimeSpan.Zero, decision.Delay);
        Assert.Equal(1, decision.Attempt);
    }

    [Fact]
    public void UsesBoundedExponentialBackoffForRepeatedFailures()
    {
        var policy = CreatePolicy(jitter: 0.5);

        _ = policy.Next(WebViewFailureKind.RendererProcessExited);
        var second = policy.Next(WebViewFailureKind.RendererProcessExited);
        var third = policy.Next(WebViewFailureKind.RendererProcessExited);

        Assert.Equal(TimeSpan.FromMilliseconds(2250), second.Delay);
        Assert.Equal(TimeSpan.FromMilliseconds(4500), third.Delay);
        Assert.True(third.Delay <= TimeSpan.FromSeconds(30));
    }

    [Fact]
    public void StopsAutomaticRecoveryAfterBoundedAttempts()
    {
        var policy = CreatePolicy();

        for (var attempt = 0; attempt < 4; attempt++)
        {
            Assert.NotEqual(
                WebViewRecoveryAction.ShowManualRetry,
                policy.Next(WebViewFailureKind.BrowserProcessExited).Action);
        }

        var exhausted = policy.Next(WebViewFailureKind.BrowserProcessExited);

        Assert.Equal(WebViewRecoveryAction.ShowManualRetry, exhausted.Action);
        Assert.Equal(5, exhausted.Attempt);
    }

    [Fact]
    public void ReloadsForTemporaryNetworkFailureWithoutDeletingProfile()
    {
        var policy = CreatePolicy();

        var decision = policy.Next(WebViewFailureKind.Network);

        Assert.Equal(WebViewRecoveryAction.Reload, decision.Action);
        Assert.False(decision.DeleteProfile);
    }

    [Theory]
    [InlineData(WebViewFailureKind.RuntimeUnavailable)]
    [InlineData(WebViewFailureKind.Certificate)]
    public void DoesNotAutomaticallyRetryPermanentFailures(WebViewFailureKind kind)
    {
        var policy = CreatePolicy();

        var decision = policy.Next(kind);

        Assert.Equal(WebViewRecoveryAction.ShowManualRetry, decision.Action);
        Assert.Equal(TimeSpan.Zero, decision.Delay);
        Assert.False(decision.DeleteProfile);
    }

    [Fact]
    public void FailuresExpireAfterStabilityWindow()
    {
        var now = new DateTimeOffset(2026, 8, 11, 12, 0, 0, TimeSpan.Zero);
        var policy = CreatePolicy(() => now);
        _ = policy.Next(WebViewFailureKind.BrowserProcessExited);
        _ = policy.Next(WebViewFailureKind.BrowserProcessExited);

        now = now.AddMinutes(6);
        var recovered = policy.Next(WebViewFailureKind.BrowserProcessExited);

        Assert.Equal(1, recovered.Attempt);
        Assert.Equal(TimeSpan.Zero, recovered.Delay);
    }

    private static WebViewRecoveryPolicy CreatePolicy(
        Func<DateTimeOffset>? utcNow = null,
        double jitter = 0) =>
        new(utcNow ?? (() => DateTimeOffset.UtcNow), () => jitter);
}
