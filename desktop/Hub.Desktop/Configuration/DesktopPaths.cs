using System.IO;
using Hub.Desktop.Diagnostics;

namespace Hub.Desktop.Configuration;

public static class DesktopPaths
{
    internal static readonly string Root = ResolveRoot();

    public static string UserDataFolder { get; } = ResolveUserDataFolder();

    /// <summary>
    /// Отдельный профиль WebView2 для ридера HTML-писем: внешние ресурсы письма
    /// грузятся анонимно — без cookie и кэша портальной сессии основного окна.
    /// </summary>
    public static string MailUserDataFolder { get; } = ResolveMailUserDataFolder();

    public static string LogsFolder { get; } = Path.Combine(Root, "Logs");

    public static string SettingsFile { get; } = Path.Combine(Root, "settings.json");

    public static string UpdatesFolder { get; } = Path.Combine(Root, "Updates");

    public static string UpdatePackagesFolder { get; } = Path.Combine(UpdatesFolder, "Packages");

    public static string UpdateRunnersFolder { get; } = Path.Combine(UpdatesFolder, "Runners");

    private static string ResolveRoot()
    {
        if (DesktopPerfBench.TryGetIsolatedRoot(out var isolatedRoot))
        {
            return isolatedRoot;
        }

        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "HUB-IT",
            "Desktop");
    }

    private static string ResolveUserDataFolder()
    {
        if (DesktopPerfBench.TryGetUserDataFolder(out var folder))
        {
            return folder;
        }

        return Path.Combine(Root, "WebView2");
    }

    private static string ResolveMailUserDataFolder()
    {
        // Соседняя папка рядом с основным профилем WebView2 — bench-изоляция
        // (TryGetUserDataFolder/Root) применяется к почтовому профилю так же.
        var parent = Path.GetDirectoryName(UserDataFolder.TrimEnd(Path.DirectorySeparatorChar));
        return Path.Combine(
            string.IsNullOrEmpty(parent) ? Root : parent,
            "WebView2Mail");
    }
}
