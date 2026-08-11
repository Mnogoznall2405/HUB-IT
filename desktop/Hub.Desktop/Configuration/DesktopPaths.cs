namespace Hub.Desktop.Configuration;

public static class DesktopPaths
{
    private static readonly string Root = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "HUB-IT",
        "Desktop");

    public static string UserDataFolder { get; } = Path.Combine(Root, "WebView2");

    public static string LogsFolder { get; } = Path.Combine(Root, "Logs");
}
