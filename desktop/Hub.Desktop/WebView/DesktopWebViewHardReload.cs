using System.Runtime.InteropServices;
using Hub.Desktop.Diagnostics;
using Microsoft.Web.WebView2.Core;

namespace Hub.Desktop.WebView;

public static class DesktopWebViewHardReload
{
    public static CoreWebView2BrowsingDataKinds CacheKinds { get; } =
        CoreWebView2BrowsingDataKinds.DiskCache
        | CoreWebView2BrowsingDataKinds.CacheStorage
        | CoreWebView2BrowsingDataKinds.ServiceWorkers;

    public static async Task<bool> TryReloadIgnoringCacheAsync(
        CoreWebView2? core,
        CancellationToken cancellationToken)
    {
        if (core is null)
        {
            return false;
        }

        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            await core.Profile.ClearBrowsingDataAsync(CacheKinds);
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                await core.CallDevToolsProtocolMethodAsync(
                    "Page.reload",
                    """{"ignoreCache":true}""");
            }
            catch (Exception exception) when (
                exception is InvalidOperationException
                or COMException
                or ArgumentException)
            {
                core.Reload();
            }

            DesktopLog.Info("Reloaded the current HUB page after clearing cache");
            return true;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception) when (
            exception is InvalidOperationException
            or COMException)
        {
            DesktopLog.Error("Hard reload without cache failed", exception);
            return false;
        }
    }
}
