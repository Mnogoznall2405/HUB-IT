using Hub.Desktop.Diagnostics;
using Microsoft.Web.WebView2.Wpf;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopMemoryProcessSnapshotTests
{
    [Fact]
    public void SkipsMissingWebViewDuringRecreation()
    {
        Assert.Null(DesktopMemoryProcessSnapshot.TryCapture(null));
    }

    [Fact]
    public void SkipsDisposedWebViewAndAllowsReplacement()
    {
        Exception? captured = null;
        var thread = new Thread(() =>
        {
            try
            {
                using var previous = new WebView2();
                previous.Dispose();
                // Exercise the same throwing property as the production crash.
                Assert.Throws<ObjectDisposedException>(() => previous.CoreWebView2);
                Assert.Null(DesktopMemoryProcessSnapshot.TryCapture(previous));

                using var replacement = new WebView2();
                Assert.Null(DesktopMemoryProcessSnapshot.TryCapture(replacement));
            }
            catch (Exception exception)
            {
                captured = exception;
            }
        }) { IsBackground = true };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();

        Assert.True(thread.Join(TimeSpan.FromSeconds(10)), "WebView2 probe timed out.");
        Assert.Null(captured);
    }
}
