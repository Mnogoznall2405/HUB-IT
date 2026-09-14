using System.IO;
using Microsoft.Web.WebView2.Core;
using Hub.Desktop.Downloads;
using Hub.Desktop.Diagnostics;
using Hub.Desktop.Lifecycle;
using Hub.Desktop.Notifications;
using Hub.Desktop.Security;
using Hub.Desktop.Shell;
using Hub.Desktop.Remote;
using Hub.Desktop.Printing;
using Hub.Desktop.Transfers;

namespace Hub.Desktop.Interop;

public sealed class DesktopBridgeHost : IDisposable
{
    private readonly CoreWebView2 _core;
    private readonly IDesktopNotificationService _notifications;
    private readonly NavigationPolicy _navigationPolicy;
    private readonly string _windowsUsername;
    private readonly DesktopVncHandlerProbe _vncHandlerProbe;
    private readonly DesktopSharedFileRegistry _sharedFiles;
    private bool _bridgeReady;
    private bool _disposed;

    public event EventHandler? Ready;
    public event EventHandler<DesktopOpenDownloadedFileRequestedEventArgs>? OpenDownloadedFileRequested;
    public event EventHandler<DesktopPrepareDownloadedFileRequestedEventArgs>? PrepareDownloadedFileRequested;
    public event EventHandler<DesktopThemeChangedEventArgs>? ThemeChanged;
    public event EventHandler<DesktopShellStatusChangedEventArgs>? ShellStatusChanged;
    public event EventHandler<DesktopQuickRoutesChangedEventArgs>? QuickRoutesChanged;
    public event EventHandler? PrintCurrentDocumentRequested;
    public event EventHandler<DesktopEquipmentQrPrintRequestedEventArgs>? EquipmentQrPrintRequested;
    public event EventHandler? OpenDownloadsRequested;
    public event EventHandler? OpenDiagnosticsRequested;
    public event EventHandler? CheckForUpdatesRequested;
    public event EventHandler? OpenCurrentInBrowserRequested;
    public event EventHandler<DesktopMailComposeWindowRequestedEventArgs>? MailComposeWindowRequested;
    public event EventHandler<DesktopMailComposeWindowCloseResultEventArgs>? MailComposeWindowCloseResult;
    public event EventHandler? MailComposeWindowSent;
    public event EventHandler<DesktopOpenFileDialogRequestedEventArgs>? OpenFileDialogRequested;

    public DesktopBridgeHost(
        CoreWebView2 core,
        NavigationPolicy navigationPolicy,
        IDesktopNotificationService notifications,
        string windowsUsername,
        DesktopVncHandlerProbe vncHandlerProbe,
        Uri trustedBaseUri)
    {
        _core = core;
        _navigationPolicy = navigationPolicy;
        _notifications = notifications;
        _windowsUsername = windowsUsername;
        _vncHandlerProbe = vncHandlerProbe ?? throw new ArgumentNullException(nameof(vncHandlerProbe));
        _sharedFiles = new DesktopSharedFileRegistry(trustedBaseUri);
        _core.WebMessageReceived += Core_WebMessageReceived;
        _core.AddWebResourceRequestedFilter(
            _sharedFiles.ShareUrlFilter,
            CoreWebView2WebResourceContext.All);
        _core.WebResourceRequested += Core_WebResourceRequested;
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
        _core.WebResourceRequested -= Core_WebResourceRequested;
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

    public bool TryPostSystemLifecycle(DesktopSystemLifecycleMessage message)
    {
        ArgumentNullException.ThrowIfNull(message);
        if (_disposed || !_bridgeReady || !IsTrustedDocument(_core.Source))
        {
            return false;
        }

        try
        {
            _core.PostWebMessageAsJson(DesktopBridgeProtocol.CreateSystemLifecycleMessage(message));
            return true;
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Desktop system lifecycle update failed", exception);
            return false;
        }
    }

    public bool TryOpenCommandPalette()
    {
        if (_disposed || !_bridgeReady || !IsTrustedDocument(_core.Source))
        {
            return false;
        }

        try
        {
            _core.PostWebMessageAsJson(DesktopBridgeProtocol.CreateOpenCommandPaletteMessage());
            return true;
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Desktop command palette request failed", exception);
            return false;
        }
    }

    public bool TryRequestMailComposeWindowClose(string requestId)
    {
        if (_disposed || !_bridgeReady || !IsTrustedDocument(_core.Source))
        {
            return false;
        }
        try
        {
            _core.PostWebMessageAsJson(DesktopBridgeProtocol.CreateMailComposeWindowCloseRequestedMessage(requestId));
            return true;
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Desktop compose close request failed", exception);
            return false;
        }
    }

    public bool TryPostMailComposeWindowCompleted()
    {
        if (_disposed || !_bridgeReady || !IsTrustedDocument(_core.Source))
        {
            return false;
        }
        try
        {
            _core.PostWebMessageAsJson(DesktopBridgeProtocol.CreateMailComposeWindowCompletedMessage());
            return true;
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Desktop compose completion notification failed", exception);
            return false;
        }
    }

    public bool TryPostAccessibility(bool highContrast, bool reducedMotion, string? scheme)
    {
        if (_disposed || !_bridgeReady || !IsTrustedDocument(_core.Source))
        {
            return false;
        }

        try
        {
            _core.PostWebMessageAsJson(
                DesktopBridgeProtocol.CreateAccessibilityMessage(highContrast, reducedMotion, scheme));
            return true;
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Desktop accessibility notification failed", exception);
            return false;
        }
    }

    public bool TryPostOpenFileDialogResult(string requestId, IReadOnlyList<string> paths)
    {
        if (_disposed || !_bridgeReady || !IsTrustedDocument(_core.Source))
        {
            return false;
        }

        try
        {
            _core.PostWebMessageAsJson(
                DesktopBridgeProtocol.CreateOpenFileDialogResultMessage(requestId, paths));
            return true;
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Desktop open file dialog result failed", exception);
            return false;
        }
    }

    public bool TryPostFileDropped(IReadOnlyList<string> paths)
    {
        if (_disposed || !_bridgeReady || !IsTrustedDocument(_core.Source))
        {
            return false;
        }

        try
        {
            var files = _sharedFiles.Register(paths);
            if (files.Count == 0)
            {
                return false;
            }

            _core.PostWebMessageAsJson(DesktopBridgeProtocol.CreateFileDroppedMessage(files));
            return true;
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Desktop file drop notification failed", exception);
            return false;
        }
    }

    public bool TryPostFileShared(IReadOnlyList<string> paths)
    {
        if (_disposed || !_bridgeReady || !IsTrustedDocument(_core.Source))
        {
            return false;
        }

        try
        {
            var files = _sharedFiles.Register(paths);
            if (files.Count == 0)
            {
                return true;
            }

            _core.PostWebMessageAsJson(DesktopBridgeProtocol.CreateFileSharedMessage(files));
            return true;
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Desktop file share notification failed", exception);
            return false;
        }
    }

    private void Core_WebResourceRequested(
        object? sender,
        CoreWebView2WebResourceRequestedEventArgs e)
    {
        if (!Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var uri)
            || !_sharedFiles.TryGetFilePath(uri, out var path))
        {
            return;
        }

        if (!IsTrustedDocument(_core.Source))
        {
            e.Response = _core.Environment.CreateWebResourceResponse(
                null, 403, "Forbidden", string.Empty);
            return;
        }

        try
        {
            var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            var headers = string.Join(
                "\r\n",
                "Content-Type: application/octet-stream",
                $"Content-Length: {stream.Length}",
                $"Content-Disposition: attachment; filename*=UTF-8''{Uri.EscapeDataString(Path.GetFileName(path))}",
                "Cache-Control: no-store",
                "X-Content-Type-Options: nosniff");
            e.Response = _core.Environment.CreateWebResourceResponse(stream, 200, "OK", headers);
            DesktopLog.Info($"Serving shared file {Path.GetFileName(path)} ({stream.Length} bytes)");
        }
        catch (Exception exception) when (
            exception is IOException
            or UnauthorizedAccessException
            or System.Security.SecurityException)
        {
            DesktopLog.Warning($"Shared file could not be served; error={exception.Message}");
            e.Response = _core.Environment.CreateWebResourceResponse(
                null, 404, "Not Found", string.Empty);
        }
    }

    private async void Core_WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            await HandleWebMessageAsync(e);
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Desktop bridge message handler failed", exception);
        }
    }

    private async Task HandleWebMessageAsync(CoreWebView2WebMessageReceivedEventArgs e)
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
            _core.PostWebMessageAsJson(DesktopBridgeProtocol.CreateCapabilitiesMessage());
            DesktopLog.Info("Desktop bridge handshake completed");
            Ready?.Invoke(this, EventArgs.Empty);
            return;
        }

        if (message.Type == DesktopInboundMessageType.OpenMailComposeWindow
            && message.MailComposeWindow is { } openCompose)
        {
            var eventArgs = new DesktopMailComposeWindowRequestedEventArgs(openCompose.Route);
            if (_bridgeReady)
            {
                MailComposeWindowRequested?.Invoke(this, eventArgs);
            }
            _core.PostWebMessageAsJson(
                DesktopBridgeProtocol.CreateMailComposeWindowResultMessage(
                    openCompose.RequestId,
                    eventArgs.Status));
            return;
        }

        if (message.Type == DesktopInboundMessageType.MailComposeWindowCloseResult
            && message.MailComposeWindow is { } closeCompose)
        {
            MailComposeWindowCloseResult?.Invoke(
                this,
                new DesktopMailComposeWindowCloseResultEventArgs(
                    closeCompose.RequestId,
                    closeCompose.Status == "saved"));
            return;
        }

        if (message.Type == DesktopInboundMessageType.MailComposeWindowSent)
        {
            MailComposeWindowSent?.Invoke(this, EventArgs.Empty);
            return;
        }

        if (message.Type == DesktopInboundMessageType.OpenFileDialog
            && message.OpenFileDialog is { } openFileDialog)
        {
            var eventArgs = new DesktopOpenFileDialogRequestedEventArgs(
                openFileDialog.RequestId,
                openFileDialog.Multiple,
                openFileDialog.Accept,
                openFileDialog.Title);
            if (_bridgeReady)
            {
                OpenFileDialogRequested?.Invoke(this, eventArgs);
            }

            TryPostOpenFileDialogResult(openFileDialog.RequestId, eventArgs.Paths);
            return;
        }

        if (message.Type == DesktopInboundMessageType.UpdateShellStatus
            && message.ShellStatus is not null)
        {
            if (!_bridgeReady)
            {
                DesktopLog.Warning("Rejected desktop shell status before bridge handshake");
                return;
            }

            ShellStatusChanged?.Invoke(
                this,
                new DesktopShellStatusChangedEventArgs(message.ShellStatus));
            return;
        }

        if (message.Type == DesktopInboundMessageType.UpdateQuickRoutes
            && message.QuickRoutes is not null)
        {
            if (!_bridgeReady)
            {
                DesktopLog.Warning("Rejected desktop quick routes before bridge handshake");
                return;
            }

            QuickRoutesChanged?.Invoke(
                this,
                new DesktopQuickRoutesChangedEventArgs(message.QuickRoutes));
            return;
        }

        if (message.Type == DesktopInboundMessageType.PrintCurrentDocument)
        {
            if (!_bridgeReady)
            {
                DesktopLog.Warning("Rejected desktop print request before bridge handshake");
                return;
            }

            PrintCurrentDocumentRequested?.Invoke(this, EventArgs.Empty);
            return;
        }

        if (message.Type == DesktopInboundMessageType.PrintEquipmentQrBatch
            && message.EquipmentQrPrint is { } qrPrint)
        {
            var status = DesktopEquipmentQrPrintStatus.Failed;
            if (!_bridgeReady)
            {
                DesktopLog.Warning("Rejected equipment QR print request before bridge handshake");
            }
            else
            {
                var eventArgs = new DesktopEquipmentQrPrintRequestedEventArgs(qrPrint.Mode);
                EquipmentQrPrintRequested?.Invoke(this, eventArgs);
                if (eventArgs.Completion is not null)
                {
                    try
                    {
                        status = await eventArgs.Completion;
                    }
                    catch (Exception exception)
                    {
                        DesktopLog.Error("Equipment QR print request failed", exception);
                    }
                }
            }

            try
            {
                _core.PostWebMessageAsJson(
                    DesktopBridgeProtocol.CreateEquipmentQrPrintResultMessage(
                        qrPrint.RequestId,
                        status));
            }
            catch (Exception exception)
            {
                DesktopLog.Error("Equipment QR print response failed", exception);
            }
            return;
        }

        if (message.Type is
            DesktopInboundMessageType.OpenDownloads
            or DesktopInboundMessageType.OpenDiagnostics
            or DesktopInboundMessageType.CheckForUpdates
            or DesktopInboundMessageType.OpenCurrentInBrowser)
        {
            if (!_bridgeReady)
            {
                DesktopLog.Warning("Rejected desktop action before bridge handshake");
                return;
            }

            switch (message.Type)
            {
                case DesktopInboundMessageType.OpenDownloads:
                    OpenDownloadsRequested?.Invoke(this, EventArgs.Empty);
                    break;
                case DesktopInboundMessageType.OpenDiagnostics:
                    OpenDiagnosticsRequested?.Invoke(this, EventArgs.Empty);
                    break;
                case DesktopInboundMessageType.CheckForUpdates:
                    CheckForUpdatesRequested?.Invoke(this, EventArgs.Empty);
                    break;
                case DesktopInboundMessageType.OpenCurrentInBrowser:
                    OpenCurrentInBrowserRequested?.Invoke(this, EventArgs.Empty);
                    break;
            }

            return;
        }

        if (message.Type == DesktopInboundMessageType.SetTheme
            && message.ThemeMode is DesktopThemeMode themeMode)
        {
            ThemeChanged?.Invoke(this, new DesktopThemeChangedEventArgs(themeMode));
            return;
        }

        if (message.Type == DesktopInboundMessageType.VncPreflight)
        {
            if (!_bridgeReady)
            {
                DesktopLog.Warning("Rejected VNC preflight before bridge handshake");
                return;
            }

            try
            {
                _core.PostWebMessageAsJson(
                    DesktopBridgeProtocol.CreateVncPreflightResultMessage(
                        _vncHandlerProbe.IsAvailable()));
            }
            catch (Exception exception)
            {
                DesktopLog.Error("Desktop VNC preflight response failed", exception);
            }

            return;
        }

        if (message.Type == DesktopInboundMessageType.OpenDownloadedFile)
        {
            var eventArgs = new DesktopOpenDownloadedFileRequestedEventArgs();
            OpenDownloadedFileRequested?.Invoke(this, eventArgs);
            try
            {
                _core.PostWebMessageAsJson(
                    DesktopBridgeProtocol.CreateOpenDownloadedFileResultMessage(eventArgs.Accepted));
            }
            catch (Exception exception)
            {
                DesktopLog.Error("Desktop open-download response failed", exception);
            }
            return;
        }

        if (message.Type == DesktopInboundMessageType.PrepareDownloadedFile)
        {
            var eventArgs = new DesktopPrepareDownloadedFileRequestedEventArgs(
                message.DownloadedFileAction);
            PrepareDownloadedFileRequested?.Invoke(this, eventArgs);
            try
            {
                _core.PostWebMessageAsJson(
                    DesktopBridgeProtocol.CreatePrepareDownloadedFileResultMessage(
                        eventArgs.Action,
                        eventArgs.Accepted));
            }
            catch (Exception exception)
            {
                DesktopLog.Error("Desktop file-action response failed", exception);
            }
            return;
        }

        if (message.Type == DesktopInboundMessageType.ShowNotification && message.Notification is not null)
        {
            var accepted = false;
            try
            {
                accepted = _notifications.TryShow(message.Notification);
            }
            catch (Exception exception)
            {
                DesktopLog.Error("Desktop notification delivery failed", exception);
            }
            if (!accepted) DesktopLog.Warning("Windows app notification could not be shown");
            _core.PostWebMessageAsJson(DesktopBridgeProtocol.CreateNotificationResultMessage(
                message.Notification.Id, accepted));
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

public sealed class DesktopOpenDownloadedFileRequestedEventArgs : EventArgs
{
    public bool Accepted { get; set; }
}

public sealed class DesktopPrepareDownloadedFileRequestedEventArgs(
    DesktopDownloadedFileAction action) : EventArgs
{
    public DesktopDownloadedFileAction Action { get; } = action;

    public bool Accepted { get; set; }
}

public sealed class DesktopEquipmentQrPrintRequestedEventArgs(
    DesktopEquipmentQrPrintMode mode) : EventArgs
{
    public DesktopEquipmentQrPrintMode Mode { get; } = mode;

    public Task<DesktopEquipmentQrPrintStatus>? Completion { get; set; }
}

public sealed class DesktopShellStatusChangedEventArgs(DesktopShellStatus status) : EventArgs
{
    public DesktopShellStatus Status { get; } = status;
}

public sealed class DesktopQuickRoutesChangedEventArgs(
    IReadOnlyList<DesktopQuickRoute> routes) : EventArgs
{
    public IReadOnlyList<DesktopQuickRoute> Routes { get; } = routes;
}

public sealed class DesktopMailComposeWindowRequestedEventArgs(string route) : EventArgs
{
    public string Route { get; } = route;

    public string Status { get; set; } = "failed";
}

public sealed class DesktopMailComposeWindowCloseResultEventArgs(string requestId, bool saved) : EventArgs
{
    public string RequestId { get; } = requestId;

    public bool Saved { get; } = saved;
}

public sealed class DesktopOpenFileDialogRequestedEventArgs(
    string requestId,
    bool multiple,
    IReadOnlyList<string> accept,
    string? title) : EventArgs
{
    public string RequestId { get; } = requestId;

    public bool Multiple { get; } = multiple;

    public IReadOnlyList<string> Accept { get; } = accept;

    public string? Title { get; } = title;

    public IReadOnlyList<string> Paths { get; set; } = Array.Empty<string>();
}
