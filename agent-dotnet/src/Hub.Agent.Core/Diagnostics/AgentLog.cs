using System.Text;

namespace Hub.Agent.Core.Diagnostics;

/// <summary>
/// File logger with the same on-disk layout and rotation policy as the Python
/// agent: itinvent_agent.log + two rotated copies, 10 MB per file, 3 files total.
/// </summary>
public sealed class AgentLog : IDisposable
{
    private const long MaxBytes = 10L * 1024 * 1024;
    private const int KeepTotalFiles = 3;

    private readonly object _gate = new();
    private readonly TextWriter? _console;
    private StreamWriter? _writer;
    private bool _disposed;

    private AgentLog(string path, StreamWriter? writer, TextWriter? console)
    {
        Path = path;
        _writer = writer;
        _console = console;
    }

    public string Path { get; }

    public static AgentLog Create(string logPath, bool mirrorToConsole)
    {
        PruneRotatedFiles(logPath);
        StreamWriter? writer = null;
        try
        {
            var directory = System.IO.Path.GetDirectoryName(logPath);
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }

            writer = OpenWriter(logPath, append: true);
        }
        catch (Exception)
        {
            writer = null;
        }

        var console = mirrorToConsole ? Console.Out : null;
        return new AgentLog(logPath, writer, console);
    }

    private static StreamWriter OpenWriter(string path, bool append)
        => new(
            new FileStream(path, append ? FileMode.Append : FileMode.Create, FileAccess.Write, FileShare.ReadWrite),
            new UTF8Encoding(false))
        {
            AutoFlush = true,
        };

    public static void PruneRotatedFiles(string logPath)
    {
        try
        {
            var directory = System.IO.Path.GetDirectoryName(logPath);
            if (string.IsNullOrEmpty(directory) || !Directory.Exists(directory))
            {
                return;
            }

            var prefix = System.IO.Path.GetFileName(logPath) + ".";
            var rotated = Directory.EnumerateFiles(directory, prefix + "*")
                .Select(path => (Path: path, Suffix: System.IO.Path.GetFileName(path)[prefix.Length..]))
                .Where(item => int.TryParse(item.Suffix, out _))
                .OrderBy(item => int.Parse(item.Suffix))
                .ToList();

            foreach (var (path, _) in rotated.Skip(KeepTotalFiles - 1))
            {
                try
                {
                    File.Delete(path);
                }
                catch (Exception)
                {
                    // best effort, same as the Python agent
                }
            }
        }
        catch (Exception)
        {
            // best effort
        }
    }

    public void Info(string message) => Write("INFO", message);
    public void Warn(string message) => Write("WARNING", message);
    public void Error(string message) => Write("ERROR", message);
    public void Debug(string message) => Write("DEBUG", message);

    public void Exception(string message, Exception ex) => Write("ERROR", $"{message}: {ex}");

    private void Write(string level, string message)
    {
        if (_disposed)
        {
            return;
        }

        var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} [{level}] {message}";
        lock (_gate)
        {
            try
            {
                RotateIfNeeded();
                _writer?.WriteLine(line);
            }
            catch (Exception)
            {
                // never let logging take the agent down
            }

            try
            {
                _console?.WriteLine(line);
            }
            catch (Exception)
            {
                // console is best effort
            }
        }
    }

    private void RotateIfNeeded()
    {
        if (_writer is null)
        {
            return;
        }

        long length;
        try
        {
            length = _writer.BaseStream.Length;
        }
        catch (Exception)
        {
            return;
        }

        if (length < MaxBytes)
        {
            return;
        }

        try
        {
            _writer.Dispose();
        }
        catch (Exception)
        {
            // ignore
        }

        _writer = null;
        try
        {
            for (var index = KeepTotalFiles - 1; index >= 1; index--)
            {
                var source = index == 1 ? Path : $"{Path}.{index - 1}";
                var target = $"{Path}.{index}";
                if (File.Exists(source))
                {
                    File.Move(source, target, overwrite: true);
                }
            }
        }
        catch (Exception)
        {
            // rotation failure must not stop logging
        }

        try
        {
            _writer = OpenWriter(Path, append: false);
        }
        catch (Exception)
        {
            _writer = null;
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            _disposed = true;
            try
            {
                _writer?.Dispose();
            }
            catch (Exception)
            {
                // ignore
            }

            _writer = null;
        }
    }
}
