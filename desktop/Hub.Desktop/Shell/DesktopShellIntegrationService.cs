using System.IO;
using Microsoft.Win32;
using Hub.Desktop.Diagnostics;

namespace Hub.Desktop.Shell;

public sealed class DesktopShellIntegrationService
{
    private const string SendToShortcutName = "HUB Desktop.lnk";
    private const string FileContextMenuKey = @"Software\Classes\*\shell\HUBDesktopShare";
    private const string DirectoryContextMenuKey = @"Software\Classes\Directory\shell\HUBDesktopShare";
    private const string InstallerOptionsKey = @"SOFTWARE\HUB-IT\Desktop\InstallerOptions";

    public void EnsureIntegration(string executablePath)
    {
        ArgumentException.ThrowIfNullOrEmpty(executablePath);

        EnsureSendToShortcut(executablePath);
        EnsureContextMenu(FileContextMenuKey, executablePath, "Отправить в HUB");
        EnsureContextMenu(DirectoryContextMenuKey, executablePath, "Отправить в HUB");
    }

    internal static bool ReadTaskbarPinOption()
    {
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(InstallerOptionsKey, writable: false);
            if (key is null)
            {
                return false;
            }

            return Convert.ToBoolean(key.GetValue("Taskbar", 0) ?? 0);
        }
        catch (Exception exception)
        {
            DesktopLog.Warning($"Failed to read installer options; error={exception.Message}");
            return false;
        }
    }

    private static void CreateShellShortcut(
        string executablePath,
        string shortcutPath,
        string arguments = "",
        string? workingDirectory = null)
    {
        var shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType is null)
        {
            DesktopLog.Warning("WScript.Shell is not available; shell shortcut not created");
            return;
        }

        var shortcutWorkingDirectory = workingDirectory
            ?? Path.GetDirectoryName(executablePath)
            ?? Path.GetPathRoot(executablePath)!;

        dynamic shell = Activator.CreateInstance(shellType)!;
        dynamic shortcut = shell.CreateShortcut(shortcutPath)!;
        shortcut.TargetPath = executablePath;
        shortcut.Arguments = arguments;
        shortcut.WorkingDirectory = shortcutWorkingDirectory;
        shortcut.IconLocation = $"{executablePath},0";
        shortcut.Save();
    }

    private static void EnsureSendToShortcut(string executablePath)
    {
        var sendToFolder = Environment.GetFolderPath(Environment.SpecialFolder.SendTo);
        if (string.IsNullOrWhiteSpace(sendToFolder))
        {
            return;
        }

        var shortcutPath = Path.Combine(sendToFolder, SendToShortcutName);
        CreateShellShortcut(executablePath, shortcutPath, "--share");
        DesktopLog.Info($"SendTo shortcut created or updated at {shortcutPath}");
    }

    private static void EnsureContextMenu(string keyPath, string executablePath, string title)
    {
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(keyPath);
            if (key is null)
            {
                return;
            }

            key.SetValue(string.Empty, title);
            using var commandKey = key.CreateSubKey("command");
            commandKey?.SetValue(string.Empty, $"\"{executablePath}\" --share \"%1\"");
        }
        catch (Exception exception)
        {
            DesktopLog.Error($"Failed to register context menu at {keyPath}", exception);
        }
    }

}
