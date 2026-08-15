using Microsoft.Web.WebView2.Core;

namespace Hub.Desktop.WebView;

public static class DesktopWebViewMemoryPolicy
{
    public static CoreWebView2MemoryUsageTargetLevel ResolveTargetLevel(
        bool isVisible,
        bool isMinimized,
        bool isActive) =>
        isVisible && !isMinimized && isActive
            ? CoreWebView2MemoryUsageTargetLevel.Normal
            : CoreWebView2MemoryUsageTargetLevel.Low;
}
