using Hub.Desktop.Downloads;
using Microsoft.Web.WebView2.Core;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopDownloadInterruptionTests
{
    [Theory]
    [InlineData(CoreWebView2DownloadInterruptReason.UserCanceled)]
    [InlineData(CoreWebView2DownloadInterruptReason.UserShutdown)]
    public void TreatsExplicitUserStopsAsCanceled(CoreWebView2DownloadInterruptReason reason)
    {
        Assert.True(DesktopDownloadInterruption.IsCanceled(reason));
        Assert.False(DesktopDownloadInterruption.ShouldWaitForResume(reason));
    }

    [Fact]
    public void KeepsListeningWhileAUserPausedDownloadCanResume()
    {
        Assert.True(DesktopDownloadInterruption.ShouldWaitForResume(
            CoreWebView2DownloadInterruptReason.UserPaused));
        Assert.False(DesktopDownloadInterruption.IsCanceled(
            CoreWebView2DownloadInterruptReason.UserPaused));
    }

    [Fact]
    public void TreatsNetworkInterruptionsAsFailures()
    {
        Assert.False(DesktopDownloadInterruption.IsCanceled(
            CoreWebView2DownloadInterruptReason.NetworkFailed));
        Assert.False(DesktopDownloadInterruption.ShouldWaitForResume(
            CoreWebView2DownloadInterruptReason.NetworkFailed));
    }
}
