namespace Hub.Desktop.Autostart;

public interface IAutostartService
{
    bool IsEnabled { get; }

    bool CanUserChange => true;

    void EnsureEnabledByDefault();

    void SetEnabled(bool enabled);
}
