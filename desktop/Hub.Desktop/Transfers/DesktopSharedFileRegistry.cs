using System.IO;
using Hub.Desktop.Diagnostics;

namespace Hub.Desktop.Transfers;

public sealed record DesktopSharedFileDescriptor(
    string Name,
    long Size,
    string Url,
    string? RelativePath = null);

public sealed class DesktopSharedFileRegistry
{
    public const string SharePathPrefix = "/__desktop_share__/";
    private const int MaximumFiles = 100;

    // MaximumFiles bounds one registration; these bound what the host keeps overall, so a long tray
    // session does not pile up paths and read permissions for files dropped hours ago.
    public const int MaximumRegisteredFiles = 500;
    public static readonly TimeSpan DefaultLifetime = TimeSpan.FromMinutes(30);

    private static readonly EnumerationOptions DirectoryEnumeration = new()
    {
        RecurseSubdirectories = true,
        IgnoreInaccessible = true,
        AttributesToSkip = FileAttributes.ReparsePoint | FileAttributes.System,
    };

    private readonly object _sync = new();
    private readonly Dictionary<string, string> _tokenToPath = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _pathToToken = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, DateTimeOffset> _registeredAt = new(StringComparer.Ordinal);
    private readonly string _shareUrlPrefix;
    private readonly TimeProvider _time;
    private readonly TimeSpan _lifetime;

    public DesktopSharedFileRegistry(Uri trustedBaseUri, TimeProvider? timeProvider = null, TimeSpan? lifetime = null)
    {
        ArgumentNullException.ThrowIfNull(trustedBaseUri);
        _time = timeProvider ?? TimeProvider.System;
        _lifetime = lifetime ?? DefaultLifetime;
        var origin = new Uri($"{trustedBaseUri.Scheme}://{trustedBaseUri.IdnHost}:{trustedBaseUri.Port}");
        _shareUrlPrefix = new Uri(origin, SharePathPrefix.TrimStart('/')).AbsoluteUri;
    }

    public string ShareUrlFilter => _shareUrlPrefix + "*";

    public IReadOnlyList<DesktopSharedFileDescriptor> Register(IReadOnlyList<string> paths)
    {
        ArgumentNullException.ThrowIfNull(paths);
        var descriptors = new List<DesktopSharedFileDescriptor>();

        foreach (var path in paths)
        {
            if (descriptors.Count >= MaximumFiles || string.IsNullOrWhiteSpace(path))
            {
                continue;
            }

            if (File.Exists(path))
            {
                AddFile(descriptors, path, relativePath: null);
                continue;
            }

            if (!Directory.Exists(path))
            {
                continue;
            }

            var directoryName = Path.GetFileName(path.TrimEnd(
                Path.DirectorySeparatorChar,
                Path.AltDirectorySeparatorChar));
            if (string.IsNullOrEmpty(directoryName))
            {
                continue;
            }

            try
            {
                foreach (var filePath in Directory.EnumerateFiles(path, "*", DirectoryEnumeration))
                {
                    if (descriptors.Count >= MaximumFiles)
                    {
                        break;
                    }

                    var relative = $"{directoryName}/{Path.GetRelativePath(path, filePath).Replace('\\', '/')}";
                    AddFile(descriptors, filePath, relative);
                }
            }
            catch (Exception exception) when (
                exception is IOException
                or UnauthorizedAccessException
                or System.Security.SecurityException)
            {
                DesktopLog.Warning($"Shared directory enumeration failed; error={exception.Message}");
            }
        }

        return descriptors;
    }

    private void AddFile(
        List<DesktopSharedFileDescriptor> descriptors,
        string path,
        string? relativePath)
    {
        long size;
        try
        {
            size = new FileInfo(path).Length;
        }
        catch (Exception)
        {
            return;
        }

        lock (_sync)
        {
            var now = _time.GetUtcNow();
            PurgeLocked(now);
            if (!_pathToToken.TryGetValue(path, out var token))
            {
                while (_tokenToPath.Count >= MaximumRegisteredFiles)
                {
                    RemoveLocked(_registeredAt.MinBy(entry => entry.Value).Key);
                }

                token = Guid.NewGuid().ToString("N");
                _pathToToken[path] = token;
                _tokenToPath[token] = path;
            }

            _registeredAt[token] = now;

            descriptors.Add(new DesktopSharedFileDescriptor(
                Path.GetFileName(path),
                size,
                _shareUrlPrefix + token,
                relativePath));
        }
    }

    public bool TryGetFilePath(Uri? uri, out string path)
    {
        path = string.Empty;
        if (uri is null || !uri.AbsolutePath.StartsWith(SharePathPrefix, StringComparison.Ordinal))
        {
            return false;
        }

        var token = uri.AbsolutePath[SharePathPrefix.Length..];
        if (token.Length == 0 || token.IndexOf('/') >= 0)
        {
            return false;
        }

        lock (_sync)
        {
            PurgeLocked(_time.GetUtcNow());
            return _tokenToPath.TryGetValue(token, out path!);
        }
    }

    /// <summary>Forgets every token, e.g. when the tray session ends.</summary>
    public void Clear()
    {
        lock (_sync)
        {
            _tokenToPath.Clear();
            _pathToToken.Clear();
            _registeredAt.Clear();
        }
    }

    private void PurgeLocked(DateTimeOffset now)
    {
        foreach (var token in _registeredAt.Where(entry => now - entry.Value > _lifetime).Select(entry => entry.Key).ToList())
        {
            RemoveLocked(token);
        }
    }

    private void RemoveLocked(string token)
    {
        if (_tokenToPath.Remove(token, out var path))
        {
            _pathToToken.Remove(path);
        }

        _registeredAt.Remove(token);
    }
}
