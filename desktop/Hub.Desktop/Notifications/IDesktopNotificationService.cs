using Hub.Desktop.Interop;

namespace Hub.Desktop.Notifications;

public interface IDesktopNotificationService
{
    bool IsAvailable { get; }

    bool TryShow(DesktopNotificationRequest request);

    /// <summary>
    /// Removes already delivered notifications of the group (for example <c>chat:&lt;id&gt;</c>).
    /// Best effort: must not throw and must not log notification content.
    /// </summary>
    void ClearGroup(string group);
}
