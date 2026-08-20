using System.Windows.Controls;
using Hub.Desktop.Diagnostics;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace Hub.Desktop.WebView;

public sealed class DesktopWebViewHost : IDisposable
{
    private readonly Grid _container;
    private readonly DesktopWebViewEnvironmentProvider _environmentProvider;
    private bool _disposed;

    public DesktopWebViewHost(
        Grid container,
        DesktopWebViewEnvironmentProvider environmentProvider)
    {
        _container = container ?? throw new ArgumentNullException(nameof(container));
        _environmentProvider = environmentProvider
            ?? throw new ArgumentNullException(nameof(environmentProvider));
    }

    public WebView2? View { get; private set; }

    public async Task<CoreWebView2> RecreateAsync(
        CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        cancellationToken.ThrowIfCancellationRequested();
        DisposeCurrent();
        var view = new WebView2();
        View = view;
        _container.Children.Add(view);
        try
        {
            var environment = await _environmentProvider.GetAsync(cancellationToken);
            Hub.Desktop.Diagnostics.DesktopPerfBench.MarkOnce("webview_environment_ready");
            cancellationToken.ThrowIfCancellationRequested();
            await view.EnsureCoreWebView2Async(environment);
            Hub.Desktop.Diagnostics.DesktopPerfBench.MarkOnce("webview_core_ready");
            cancellationToken.ThrowIfCancellationRequested();
            return view.CoreWebView2;
        }
        catch
        {
            DisposeCurrent();
            throw;
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        DisposeCurrent();
    }

    private void DisposeCurrent()
    {
        var view = View;
        View = null;
        if (view is null)
        {
            return;
        }

        _container.Children.Remove(view);
        view.Dispose();
    }
}
