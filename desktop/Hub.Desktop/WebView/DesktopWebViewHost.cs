using System.IO;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace Hub.Desktop.WebView;

public sealed class DesktopWebViewHost : IDisposable
{
    private readonly Grid _container;
    private bool _disposed;

    public DesktopWebViewHost(Grid container)
    {
        _container = container ?? throw new ArgumentNullException(nameof(container));
    }

    public WebView2? View { get; private set; }

    public async Task<CoreWebView2> RecreateAsync(
        string userDataFolder,
        CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        cancellationToken.ThrowIfCancellationRequested();
        DisposeCurrent();
        Directory.CreateDirectory(userDataFolder);

        var view = new WebView2();
        View = view;
        _container.Children.Add(view);
        try
        {
            var environment = await CoreWebView2Environment.CreateAsync(
                browserExecutableFolder: null,
                userDataFolder: userDataFolder);
            cancellationToken.ThrowIfCancellationRequested();
            await view.EnsureCoreWebView2Async(environment);
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
