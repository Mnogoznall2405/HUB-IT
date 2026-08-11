using Hub.Desktop.Diagnostics;
using Hub.Desktop.Interop;
using Microsoft.Windows.AppNotifications;
using Microsoft.Windows.AppNotifications.Builder;

namespace Hub.Desktop.Notifications;

public sealed class WindowsAppNotificationService : IDesktopNotificationService, IDisposable
{
    private readonly AppNotificationManager _manager = AppNotificationManager.Default;
    private bool _registered;
    private bool _disposed;

    public event EventHandler<DesktopNotificationActivationEventArgs>? Activated;

    public bool IsAvailable => _registered;

    public bool TryRegister()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        if (_registered)
        {
            return true;
        }

        try
        {
            if (!AppNotificationManager.IsSupported())
            {
                DesktopLog.Warning("Windows app notifications are not supported on this system");
                return false;
            }

            _manager.NotificationInvoked += Manager_NotificationInvoked;
            _manager.Register();
            _registered = true;
            DesktopLog.Info("Windows app notifications registered");
            return true;
        }
        catch (Exception exception)
        {
            _manager.NotificationInvoked -= Manager_NotificationInvoked;
            DesktopLog.Error("Windows app notification registration failed", exception);
            return false;
        }
    }

    public bool TryShow(DesktopNotificationRequest request)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        if (!_registered)
        {
            return false;
        }

        try
        {
            var notification = new AppNotificationBuilder()
                .AddArgument("eventId", request.Id)
                .AddArgument("route", request.Route)
                .AddText(request.Title)
                .AddText(request.Body)
                .BuildNotification();

            _manager.Show(notification);
            DesktopLog.Info("Windows app notification shown");
            return true;
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Windows app notification display failed", exception);
            return false;
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        if (!_registered)
        {
            return;
        }

        _registered = false;
        _manager.NotificationInvoked -= Manager_NotificationInvoked;

        try
        {
            _manager.Unregister();
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Windows app notification unregister failed", exception);
        }
    }

    private void Manager_NotificationInvoked(
        AppNotificationManager sender,
        AppNotificationActivatedEventArgs args)
    {
        var route = args.Arguments.TryGetValue("route", out var requestedRoute)
            && DesktopBridgeProtocol.IsValidInternalRoute(requestedRoute)
                ? requestedRoute
                : null;

        DesktopLog.Info("Windows app notification activated");
        Activated?.Invoke(this, new DesktopNotificationActivationEventArgs(route));
    }
}

public sealed record DesktopNotificationActivationEventArgs(string? Route);
