using Hub.Desktop.Interop;

namespace Hub.Desktop.Notifications;

public sealed class UnavailableDesktopNotificationService : IDesktopNotificationService
{
    public static UnavailableDesktopNotificationService Instance { get; } = new();

    private UnavailableDesktopNotificationService()
    {
    }

    public bool IsAvailable => false;

    public bool TryShow(DesktopNotificationRequest request)
    {
        return false;
    }
}
