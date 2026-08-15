using Hub.Desktop.WebView;
using Microsoft.Web.WebView2.Core;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopWebViewMemoryPolicyTests
{
    [Theory]
    [InlineData(true, false, true, CoreWebView2MemoryUsageTargetLevel.Normal)]
    [InlineData(false, false, true, CoreWebView2MemoryUsageTargetLevel.Low)]
    [InlineData(true, true, true, CoreWebView2MemoryUsageTargetLevel.Low)]
    [InlineData(true, false, false, CoreWebView2MemoryUsageTargetLevel.Low)]
    public void SelectsMemoryTargetForWindowState(
        bool isVisible,
        bool isMinimized,
        bool isActive,
        CoreWebView2MemoryUsageTargetLevel expected)
    {
        var target = DesktopWebViewMemoryPolicy.ResolveTargetLevel(
            isVisible,
            isMinimized,
            isActive);

        Assert.Equal(expected, target);
    }
}
