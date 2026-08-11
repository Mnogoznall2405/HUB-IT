namespace Hub.Desktop.Autostart;

public interface IAutostartService
{
    bool IsEnabled { get; }

    void EnsureEnabledByDefault();

    void SetEnabled(bool enabled);
}
