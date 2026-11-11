using System.Threading;
using System.Windows.Controls;
using Hub.Desktop.Diagnostics;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace Hub.Desktop.WebView;

public sealed class DesktopWebViewHost : IDisposable
{
    private readonly Grid _container;
    private readonly DesktopWebViewEnvironmentProvider _environmentProvider;
    private readonly object _sync = new();
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
        lock (_sync)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            DisposeCurrentLocked();
        }

        cancellationToken.ThrowIfCancellationRequested();
        DesktopLog.Info("Creating WebView2 control");
        var view = new WebView2();
        DesktopLog.Info("Resolving WebView2 environment");
        var environment = await _environmentProvider.GetAsync(cancellationToken);
        Hub.Desktop.Diagnostics.DesktopPerfBench.MarkOnce("webview_environment_ready");
        DesktopLog.Info("WebView2 environment resolved");
        cancellationToken.ThrowIfCancellationRequested();

        // The WebView2 WPF control must be in the visual tree before
        // EnsureCoreWebView2Async, otherwise initialization can hang waiting
        // for a valid HWND/source.
        lock (_sync)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            View = view;
            _container.Children.Add(view);
        }

        DesktopLog.Info("Initializing WebView2 core");
        await view.EnsureCoreWebView2Async(environment);
        Hub.Desktop.Diagnostics.DesktopPerfBench.MarkOnce("webview_core_ready");
        DesktopLog.Info("WebView2 core initialized");

        return view.CoreWebView2;
    }

    public void Dispose()
    {
        lock (_sync)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            DisposeCurrentLocked();
        }
    }

    private void DisposeCurrentLocked()
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

    public void SetZoomFactor(double factor)
    {
        if (factor <= 0)
        {
            return;
        }

        lock (_sync)
        {
            if (_disposed || View is null)
            {
                return;
            }

            try
            {
                View.ZoomFactor = Math.Clamp(factor, 0.25, 5.0);
            }
            catch (Exception exception)
            {
                DesktopLog.Error("Failed to set WebView2 zoom factor", exception);
            }
        }
    }
}
