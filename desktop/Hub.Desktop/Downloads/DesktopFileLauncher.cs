using System.ComponentModel;
using System.Collections.Specialized;
using System.Diagnostics;
using System.IO;
using System.Windows;
using Hub.Desktop.Diagnostics;

namespace Hub.Desktop.Downloads;

public enum DesktopFileActionResult
{
    Succeeded,
    Missing,
    Unsupported,
    NoHandler,
    Failed,
}

public sealed class DesktopFileLauncher
{
    private const int ErrorNoAssociation = 1155;
    private static readonly HashSet<string> SupportedExtensions = new(
        [
            ".doc", ".docx", ".docm", ".dot", ".dotx", ".dotm",
            ".xls", ".xlsx", ".xlsm", ".xlt", ".xltx", ".xltm",
            ".ppt", ".pptx", ".pptm", ".pps", ".ppsx", ".ppsm",
            ".odt", ".ods", ".odp", ".rtf", ".csv", ".pdf",
        ],
        StringComparer.OrdinalIgnoreCase);
    private readonly Func<string, bool> _fileExists;
    private readonly Func<string, bool> _directoryExists;
    private readonly Func<ProcessStartInfo, Process?> _startProcess;
    private readonly Action<string> _copyFileToClipboard;

    public DesktopFileLauncher()
        : this(File.Exists, Process.Start, Directory.Exists, CopyFileToClipboard)
    {
    }

    internal DesktopFileLauncher(
        Func<string, bool> fileExists,
        Func<ProcessStartInfo, Process?> startProcess,
        Func<string, bool>? directoryExists = null,
        Action<string>? copyFileToClipboard = null)
    {
        _fileExists = fileExists ?? throw new ArgumentNullException(nameof(fileExists));
        _startProcess = startProcess ?? throw new ArgumentNullException(nameof(startProcess));
        _directoryExists = directoryExists ?? Directory.Exists;
        _copyFileToClipboard = copyFileToClipboard ?? CopyFileToClipboard;
    }

    public static bool IsSupportedFileName(string? fileName)
    {
        if (string.IsNullOrWhiteSpace(fileName))
        {
            return false;
        }

        try
        {
            return SupportedExtensions.Contains(Path.GetExtension(fileName));
        }
        catch
        {
            return false;
        }
    }

    public DesktopFileActionResult TryOpen(string? path)
    {
        if (!TryGetSafeExistingPath(path, requireSupportedExtension: true, out var normalizedPath))
        {
            return ResolveRejectedPathResult(path, requireSupportedExtension: true);
        }

        // Files come from the authenticated corporate portal. Keeping the
        // internet MOTW makes Excel/Word reject legacy .xls/.doc files as
        // "corrupted" (Office File Validation + Protected View).
        RemoveMarkOfTheWeb(normalizedPath);
        try
        {
            _ = _startProcess(new ProcessStartInfo(normalizedPath)
            {
                UseShellExecute = true,
            });
            DesktopLog.Info(
                $"Downloaded document opened with the Windows handler; extension={Path.GetExtension(normalizedPath)}");
            return DesktopFileActionResult.Succeeded;
        }
        catch (Win32Exception exception) when (exception.NativeErrorCode == ErrorNoAssociation)
        {
            DesktopLog.Warning("No registered Windows application can open this document type");
            return DesktopFileActionResult.NoHandler;
        }
        catch (Exception exception)
        {
            DesktopLog.Warning(
                $"Downloaded document could not be opened; error_type={exception.GetType().Name}");
            return DesktopFileActionResult.Failed;
        }
    }

    public DesktopFileActionResult TryPrint(string? path)
    {
        if (!TryGetSafeExistingPath(path, requireSupportedExtension: true, out var normalizedPath))
        {
            return ResolveRejectedPathResult(path, requireSupportedExtension: true);
        }

        RemoveMarkOfTheWeb(normalizedPath);
        try
        {
            _ = _startProcess(new ProcessStartInfo(normalizedPath)
            {
                UseShellExecute = true,
                Verb = "print",
            });
            DesktopLog.Info(
                $"Downloaded document sent to the Windows print handler; extension={Path.GetExtension(normalizedPath)}");
            return DesktopFileActionResult.Succeeded;
        }
        catch (Win32Exception exception) when (exception.NativeErrorCode == ErrorNoAssociation)
        {
            DesktopLog.Warning("No registered Windows print handler is available for this document type");
            return DesktopFileActionResult.NoHandler;
        }
        catch (Exception exception)
        {
            DesktopLog.Warning(
                $"Downloaded document could not be printed; error_type={exception.GetType().Name}");
            return DesktopFileActionResult.Failed;
        }
    }

    public DesktopFileActionResult TryCopyToClipboard(string? path)
    {
        if (!TryGetSafeExistingPath(path, requireSupportedExtension: false, out var normalizedPath))
        {
            return ResolveRejectedPathResult(path, requireSupportedExtension: false);
        }

        try
        {
            _copyFileToClipboard(normalizedPath);
            DesktopLog.Info("Downloaded document copied to the Windows clipboard");
            return DesktopFileActionResult.Succeeded;
        }
        catch (Exception exception)
        {
            DesktopLog.Warning(
                $"Downloaded document could not be copied; error_type={exception.GetType().Name}");
            return DesktopFileActionResult.Failed;
        }
    }

    public DesktopFileActionResult TryRevealInFolder(string? path)
    {
        if (!TryGetSafeExistingPath(path, requireSupportedExtension: false, out var normalizedPath))
        {
            return ResolveRejectedPathResult(path, requireSupportedExtension: false);
        }

        try
        {
            var explorerPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                "explorer.exe");
            var startInfo = new ProcessStartInfo(explorerPath)
            {
                UseShellExecute = false,
            };
            startInfo.ArgumentList.Add("/select,");
            startInfo.ArgumentList.Add(normalizedPath);
            _ = _startProcess(startInfo);
            DesktopLog.Info("Downloaded document revealed in File Explorer");
            return DesktopFileActionResult.Succeeded;
        }
        catch (Exception exception)
        {
            DesktopLog.Warning(
                $"Downloaded document could not be revealed; error_type={exception.GetType().Name}");
            return DesktopFileActionResult.Failed;
        }
    }

    public DesktopFileActionResult TryOpenFolder(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return DesktopFileActionResult.Missing;
        }

        try
        {
            var normalizedPath = Path.GetFullPath(path);
            if (!_directoryExists(normalizedPath))
            {
                return DesktopFileActionResult.Missing;
            }

            _ = _startProcess(new ProcessStartInfo(normalizedPath)
            {
                UseShellExecute = true,
            });
            DesktopLog.Info("Windows downloads folder opened");
            return DesktopFileActionResult.Succeeded;
        }
        catch (Exception exception)
        {
            DesktopLog.Warning(
                $"Windows downloads folder could not be opened; error_type={exception.GetType().Name}");
            return DesktopFileActionResult.Failed;
        }
    }

    private bool TryGetSafeExistingPath(
        string? path,
        bool requireSupportedExtension,
        out string normalizedPath)
    {
        normalizedPath = string.Empty;
        if (string.IsNullOrWhiteSpace(path))
        {
            return false;
        }

        try
        {
            normalizedPath = Path.GetFullPath(path);
            if (requireSupportedExtension && !IsSupportedFileName(normalizedPath))
            {
                return false;
            }

            return _fileExists(normalizedPath);
        }
        catch
        {
            normalizedPath = string.Empty;
            return false;
        }
    }

    private DesktopFileActionResult ResolveRejectedPathResult(
        string? path,
        bool requireSupportedExtension)
    {
        if (requireSupportedExtension && !IsSupportedFileName(path))
        {
            DesktopLog.Warning("Rejected unsupported downloaded document type");
            return DesktopFileActionResult.Unsupported;
        }

        DesktopLog.Warning("Downloaded document is missing");
        return DesktopFileActionResult.Missing;
    }

    private static void RemoveMarkOfTheWeb(string path)
    {
        // Alternate data streams are rejected by .NET path validation;
        // Win32 DeleteFile handles "file.ext:Zone.Identifier" directly.
        try
        {
            _ = DeleteFile(path + ":Zone.Identifier");
        }
        catch (Exception)
        {
            // Best effort: missing stream or denied access must not block the open.
        }
    }

    [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode, SetLastError = true)]
    [return: System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)]
    private static extern bool DeleteFile(string fileName);

    private static void CopyFileToClipboard(string path)
    {
        var files = new StringCollection { path };
        System.Windows.Clipboard.SetFileDropList(files);
    }
}
