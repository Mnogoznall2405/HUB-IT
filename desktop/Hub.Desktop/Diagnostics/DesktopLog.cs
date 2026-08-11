using System.Globalization;
using System.Text;
using Hub.Desktop.Configuration;

namespace Hub.Desktop.Diagnostics;

public static class DesktopLog
{
    private const long MaximumFileSizeBytes = 2 * 1024 * 1024;
    private const int RetainedFiles = 5;
    private static readonly object Sync = new();
    private static string? _currentLogPath;

    public static void Initialize()
    {
        lock (Sync)
        {
            Directory.CreateDirectory(DesktopPaths.LogsFolder);
            _currentLogPath = Path.Combine(DesktopPaths.LogsFolder, "hub-desktop.log");
            RollIfNeeded();
        }

        Info("HUB Desktop starting");
    }

    public static void Info(string message) => Write("INFO", message);

    public static void Warning(string message) => Write("WARN", message);

    public static void Error(string context, Exception exception)
    {
        Write("ERROR", $"{context}; exception={exception.GetType().Name}");
    }

    private static void Write(string level, string message)
    {
        try
        {
            lock (Sync)
            {
                if (_currentLogPath is null)
                {
                    return;
                }

                RollIfNeeded();
                var timestamp = DateTimeOffset.Now.ToString("O", CultureInfo.InvariantCulture);
                File.AppendAllText(
                    _currentLogPath,
                    $"{timestamp} [{level}] {message}{Environment.NewLine}",
                    Encoding.UTF8);
            }
        }
        catch
        {
            // Logging must never stop the desktop client.
        }
    }

    private static void RollIfNeeded()
    {
        if (_currentLogPath is null
            || !File.Exists(_currentLogPath)
            || new FileInfo(_currentLogPath).Length < MaximumFileSizeBytes)
        {
            return;
        }

        for (var index = RetainedFiles - 1; index >= 1; index--)
        {
            var source = $"{_currentLogPath}.{index}";
            var destination = $"{_currentLogPath}.{index + 1}";

            if (File.Exists(source))
            {
                File.Move(source, destination, overwrite: true);
            }
        }

        File.Move(_currentLogPath, $"{_currentLogPath}.1", overwrite: true);
    }
}
