using Microsoft.Web.WebView2.Core;
using Hub.Desktop.Diagnostics;
using Hub.Desktop.Notifications;
using Hub.Desktop.Security;

namespace Hub.Desktop.Interop;

public sealed class DesktopBridgeHost : IDisposable
{
    private readonly CoreWebView2 _core;
    private readonly IDesktopNotificationService _notifications;
    private readonly NavigationPolicy _navigationPolicy;
    private readonly string _windowsUsername;
    private bool _bridgeReady;
    private bool _disposed;

    public event EventHandler? Ready;
    public event EventHandler? OpenDownloadedFileRequested;
    public event EventHandler<DesktopThemeChangedEventArgs>? ThemeChanged;

    public DesktopBridgeHost(
        CoreWebView2 core,
        NavigationPolicy navigationPolicy,
        IDesktopNotificationService notifications,
        string windowsUsername)
    {
        _core = core;
        _navigationPolicy = navigationPolicy;
        _notifications = notifications;
        _windowsUsername = windowsUsername;
        _core.WebMessageReceived += Core_WebMessageReceived;
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _bridgeReady = false;
        _core.WebMessageReceived -= Core_WebMessageReceived;
    }

    public void ResetDocumentReady()
    {
        _bridgeReady = false;
    }

    public bool TryOpenInternalRoute(string? route)
    {
        if (_disposed
            || !_bridgeReady
            || !DesktopBridgeProtocol.IsValidInternalRoute(route)
            || !IsTrustedDocument(_core.Source))
        {
            return false;
        }

        try
        {
            _core.PostWebMessageAsJson(DesktopBridgeProtocol.CreateOpenNavigationMessage(route));
            DesktopLog.Info("Desktop navigation request posted");
            return true;
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Desktop navigation request failed", exception);
            return false;
        }
    }

    public bool TrySetWindowForeground(bool foreground)
    {
        if (_disposed || !_bridgeReady || !IsTrustedDocument(_core.Source))
        {
            return false;
        }

        try
        {
            _core.PostWebMessageAsJson(DesktopBridgeProtocol.CreateWindowStateMessage(foreground));
            return true;
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Desktop window state update failed", exception);
            return false;
        }
    }

    private void Core_WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!IsTrustedDocument(e.Source) || !IsTrustedDocument(_core.Source))
        {
            DesktopLog.Warning("Rejected desktop bridge message from an untrusted origin");
            return;
        }

        if (!DesktopBridgeProtocol.TryParseInbound(e.WebMessageAsJson, out var message))
        {
            DesktopLog.Warning("Rejected invalid desktop bridge message");
            return;
        }

        if (message.Type == DesktopInboundMessageType.Ready)
        {
            _bridgeReady = true;
            _core.PostWebMessageAsJson(
                DesktopBridgeProtocol.CreateHostReadyMessage(
                    _notifications.IsAvailable,
                    _windowsUsername));
            DesktopLog.Info("Desktop bridge handshake completed");
            Ready?.Invoke(this, EventArgs.Empty);
            return;
        }

        if (message.Type == DesktopInboundMessageType.SetTheme
            && message.ThemeMode is DesktopThemeMode themeMode)
        {
            ThemeChanged?.Invoke(this, new DesktopThemeChangedEventArgs(themeMode));
            return;
        }

        if (message.Type == DesktopInboundMessageType.OpenDownloadedFile)
        {
            OpenDownloadedFileRequested?.Invoke(this, EventArgs.Empty);
            return;
        }

        if (message.Type == DesktopInboundMessageType.ShowNotification
            && message.Notification is not null
            && !_notifications.TryShow(message.Notification))
        {
            DesktopLog.Warning("Windows app notification could not be shown");
        }
    }

    private bool IsTrustedDocument(string? source)
    {
        return Uri.TryCreate(source, UriKind.Absolute, out var uri)
            && _navigationPolicy.IsTrustedOrigin(uri);
    }
}

public sealed class DesktopThemeChangedEventArgs(DesktopThemeMode mode) : EventArgs
{
    public DesktopThemeMode Mode { get; } = mode;
}
