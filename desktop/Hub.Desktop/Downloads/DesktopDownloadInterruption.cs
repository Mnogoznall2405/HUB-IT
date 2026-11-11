using Microsoft.Web.WebView2.Core;

namespace Hub.Desktop.Downloads;

public static class DesktopDownloadInterruption
{
    public static bool IsCanceled(CoreWebView2DownloadInterruptReason reason) =>
        reason is CoreWebView2DownloadInterruptReason.UserCanceled
            or CoreWebView2DownloadInterruptReason.UserShutdown;

    public static bool ShouldWaitForResume(CoreWebView2DownloadInterruptReason reason) =>
        reason == CoreWebView2DownloadInterruptReason.UserPaused;
}
