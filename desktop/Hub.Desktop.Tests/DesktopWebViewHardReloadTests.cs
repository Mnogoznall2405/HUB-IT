using Hub.Desktop.WebView;
using Microsoft.Web.WebView2.Core;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopWebViewHardReloadTests
{
    [Fact]
    public void ClearsOnlyCacheKindsAndLeavesCredentialsIntact()
    {
        var kinds = DesktopWebViewHardReload.CacheKinds;

        Assert.Equal(
            CoreWebView2BrowsingDataKinds.DiskCache
            | CoreWebView2BrowsingDataKinds.CacheStorage
            | CoreWebView2BrowsingDataKinds.ServiceWorkers,
            kinds);
        Assert.True(kinds.HasFlag(CoreWebView2BrowsingDataKinds.DiskCache));
        Assert.True(kinds.HasFlag(CoreWebView2BrowsingDataKinds.CacheStorage));
        Assert.True(kinds.HasFlag(CoreWebView2BrowsingDataKinds.ServiceWorkers));
        Assert.False(kinds.HasFlag(CoreWebView2BrowsingDataKinds.Cookies));
        Assert.False(kinds.HasFlag(CoreWebView2BrowsingDataKinds.PasswordAutosave));
        Assert.False(kinds.HasFlag(CoreWebView2BrowsingDataKinds.GeneralAutofill));
        Assert.False(kinds.HasFlag(CoreWebView2BrowsingDataKinds.DownloadHistory));
        Assert.False(kinds.HasFlag(CoreWebView2BrowsingDataKinds.AllProfile));
    }
}
