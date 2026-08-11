using Hub.Desktop.Interop;

namespace Hub.Desktop.Notifications;

public interface IDesktopNotificationService
{
    bool IsAvailable { get; }

    bool TryShow(DesktopNotificationRequest request);
}
