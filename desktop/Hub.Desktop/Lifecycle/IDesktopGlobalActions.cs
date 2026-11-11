namespace Hub.Desktop.Lifecycle;

public interface IDesktopGlobalActions
{
    void ShowDownloads();

    Task ShowDiagnosticsAsync();

    Task CheckForUpdatesAsync();
}
