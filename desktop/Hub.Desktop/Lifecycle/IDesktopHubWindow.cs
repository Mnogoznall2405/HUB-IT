namespace Hub.Desktop.Lifecycle;

public interface IDesktopHubWindow
{
    bool IsVisible { get; }

    bool IsActive { get; }

    string? CurrentSource { get; }

    event EventHandler? Activated;

    event EventHandler? Closed;

    void ShowAndActivate();

    void ShowAndNavigate(string? route);

    void ReloadWithoutCache();

    bool TryDeliverSystemLifecycle(DesktopSystemLifecycleMessage message);
}
