using System.IO;

namespace Hub.Desktop.Configuration;

public static class DesktopPaths
{
    private static readonly string Root = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "HUB-IT",
        "Desktop");

    public static string UserDataFolder { get; } = Path.Combine(Root, "WebView2");

    public static string LogsFolder { get; } = Path.Combine(Root, "Logs");

    public static string SettingsFile { get; } = Path.Combine(Root, "settings.json");

    public static string UpdatesFolder { get; } = Path.Combine(Root, "Updates");

    public static string UpdatePackagesFolder { get; } = Path.Combine(UpdatesFolder, "Packages");

    public static string UpdateRunnersFolder { get; } = Path.Combine(UpdatesFolder, "Runners");
}
