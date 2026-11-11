using Hub.Agent.Core.Configuration;
using Hub.Agent.Core.Diagnostics;
using Hub.Agent.Core.Support;

namespace Hub.Agent.Core.FsEgress;

/// <summary>
/// USB/network/profile watcher. Replaces the Python watchdog sidecar and keeps
/// the same spool layout, event schema and POST contract.
/// </summary>
public sealed class FsEgressService : IDisposable
{
    private static readonly HashSet<string> FixedChannels = new(StringComparer.OrdinalIgnoreCase)
    {
        "usb", "network", "deleted", "telegram",
    };

    private readonly AgentLog _log;
    private readonly FsEgressSpool _spool;
    private readonly bool _watchProfileDeletes;
    private readonly double _debounceSec;
    private readonly int _rateLimitPerSec;
    private readonly double _rootsRefreshSec;
    private readonly double _drainSec;
    private readonly int _batchSize;

    private readonly object _gate = new();
    private readonly Dictionary<string, (string Channel, DateTime DueAt, string SourcePath)> _pending = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, int> _failures = new(StringComparer.OrdinalIgnoreCase);
    private readonly Queue<DateTime> _recent = new();
    private readonly Dictionary<string, FileSystemWatcher> _watchers = new(StringComparer.OrdinalIgnoreCase);
    private readonly IReadOnlyList<string> _extraRoots;

    private CancellationTokenSource? _cancellation;    private Task? _loop;
    private int _dropped;

    public FsEgressService(
        AgentConfig config,
        AgentPaths paths,
        AgentLog log,
        IEnumerable<string>? extraRoots = null,
        string? spoolRootOverride = null)
    {
        _log = log;
        _extraRoots = (extraRoots ?? Array.Empty<string>()).ToList();
        var envRoots = Text.Sanitize(Environment.GetEnvironmentVariable("ITINV_FS_EGRESS_EXTRA_ROOTS"));
        if (envRoots.Length > 0)
        {
            _extraRoots = _extraRoots
                .Concat(envRoots.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                .ToList();
        }
        Enabled = Text.Truthy(Environment.GetEnvironmentVariable("ITINV_FS_EGRESS_ENABLED"), true);

        var serverUrl = Text.Sanitize(Environment.GetEnvironmentVariable("ITINV_FS_EGRESS_SERVER_URL"));
        if (serverUrl.Length == 0)
        {
            serverUrl = config.ServerUrl;
        }

        var apiKey = Text.Sanitize(Environment.GetEnvironmentVariable("ITINV_AGENT_API_KEY"));
        if (apiKey.Length == 0)
        {
            apiKey = Text.Sanitize(Environment.GetEnvironmentVariable("SCAN_AGENT_API_KEY"));
        }

        var spoolRoot = Text.Sanitize(Environment.GetEnvironmentVariable("ITINV_FS_EGRESS_SPOOL"));
        if (spoolRoot.Length == 0)
        {
            spoolRoot = spoolRootOverride ?? paths.FsEgressSpoolDir;
        }

        _spool = new FsEgressSpool(
            spoolRoot,
            serverUrl,
            apiKey,
            log,
            maxPending: Text.ToInt(Environment.GetEnvironmentVariable("ITINV_FS_EGRESS_MAX_PENDING"), 5000));

        _debounceSec = ParseDouble(Environment.GetEnvironmentVariable("ITINV_FS_EGRESS_DEBOUNCE_SEC"), 0.75);
        _rateLimitPerSec = Math.Max(1, Text.ToInt(Environment.GetEnvironmentVariable("ITINV_FS_EGRESS_RATE_LIMIT"), 30));
        _rootsRefreshSec = ParseDouble(Environment.GetEnvironmentVariable("ITINV_FS_EGRESS_ROOTS_REFRESH_SEC"), 30);
        _drainSec = ParseDouble(Environment.GetEnvironmentVariable("ITINV_FS_EGRESS_DRAIN_SEC"), 3);
        _batchSize = Math.Max(1, Text.ToInt(Environment.GetEnvironmentVariable("ITINV_FS_EGRESS_BATCH"), 50));
        _watchProfileDeletes = Text.Truthy(Environment.GetEnvironmentVariable("ITINV_FS_EGRESS_PROFILE_DELETES"), true);
    }

    public bool Enabled { get; }

    public bool IsRunning => _loop is { IsCompleted: false };

    public FsEgressStats Stats => _spool.Stats();

    public Dictionary<string, object?> Health()
    {
        var stats = _spool.Stats();
        return new Dictionary<string, object?>
        {
            ["enabled"] = Enabled,
            ["alive"] = IsRunning,
            ["pending"] = stats.Pending,
            ["dead_letter"] = stats.DeadLetter,
            ["last_sent_at"] = stats.LastSentAt,
        };
    }

    public void Start()
    {
        if (!Enabled || _loop is not null)
        {
            return;
        }

        _cancellation = new CancellationTokenSource();
        _loop = Task.Run(() => RunAsync(_cancellation.Token));
    }

    public void Stop()
    {
        try
        {
            _cancellation?.Cancel();
            _loop?.Wait(TimeSpan.FromSeconds(5));
        }
        catch (Exception)
        {
            // shutdown best effort
        }
        finally
        {
            lock (_gate)
            {
                foreach (var watcher in _watchers.Values)
                {
                    try
                    {
                        watcher.EnableRaisingEvents = false;
                        watcher.Dispose();
                    }
                    catch (Exception)
                    {
                        // ignore
                    }
                }

                _watchers.Clear();
            }

            _cancellation?.Dispose();
            _cancellation = null;
            _loop = null;
        }
    }

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        RefreshRoots(force: true);

        var lastRefresh = DateTime.UtcNow;
        var lastDrain = DateTime.MinValue;

        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                FlushDue();

                if ((DateTime.UtcNow - lastRefresh).TotalSeconds >= _rootsRefreshSec)
                {
                    RefreshRoots(force: false);
                    lastRefresh = DateTime.UtcNow;
                }

                if ((DateTime.UtcNow - lastDrain).TotalSeconds >= _drainSec)
                {
                    var stats = await _spool.DrainAsync(_batchSize, cancellationToken).ConfigureAwait(false);
                    if (stats.Pending + stats.DeadLetter > 0 || Volatile.Read(ref _dropped) > 0)
                    {
                        _log.Debug($"fs_egress drain sent={stats.Pending} failed={stats.DeadLetter} dropped={_dropped}");
                    }

                    lastDrain = DateTime.UtcNow;
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _log.Warn($"fs_egress loop error: {ex.Message}");
            }

            try
            {
                await Task.Delay(TimeSpan.FromMilliseconds(250), cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private void Offer(string path, string channel, string kind, string sourcePath = "")
    {
        if (FsEgressRoots.ShouldIgnorePath(path))
        {
            return;
        }

        var now = DateTime.UtcNow;
        lock (_gate)
        {
            while (_recent.Count > 0 && (now - _recent.Peek()).TotalSeconds > 1.0)
            {
                _recent.Dequeue();
            }

            if (_recent.Count >= _rateLimitPerSec)
            {
                _dropped++;
                return;
            }

            _recent.Enqueue(now);
            var key = $"{channel}|{path.ToLowerInvariant()}";
            _pending[key] = (channel, now.AddSeconds(_debounceSec), sourcePath);
        }
    }

    private void FlushDue()
    {
        var now = DateTime.UtcNow;
        var due = new List<(string Path, string Channel, string SourcePath)>();
        lock (_gate)
        {
            foreach (var (key, value) in _pending.ToList())
            {
                if (now < value.DueAt)
                {
                    continue;
                }

                var separator = key.IndexOf('|');
                var path = separator >= 0 ? key[(separator + 1)..] : key;
                due.Add((path, value.Channel, value.SourcePath));
                _pending.Remove(key);
            }
        }

        foreach (var (path, channel, sourcePath) in due)
        {
            var resolvedChannel = channel;
            if (!FixedChannels.Contains(channel))
            {
                resolvedChannel = FsEgressRoots.ClassifyPath(path);
                if (resolvedChannel is "local" or "unknown")
                {
                    continue;
                }
            }

            var retryKey = $"{channel}|{path.ToLowerInvariant()}";
            try
            {
                var evt = FsEgressEvent.Build(
                    resolvedChannel,
                    path,
                    srcPath: sourcePath,
                    computeHash: resolvedChannel is "usb" or "network",
                    details: new Dictionary<string, object?> { ["kind"] = "fs_watch" });

                _spool.Enqueue(evt);
                _failures.Remove(retryKey);
            }
            catch (Exception ex)
            {
                var attempts = _failures.GetValueOrDefault(retryKey) + 1;
                if (attempts < 3)
                {
                    _failures[retryKey] = attempts;
                    lock (_gate)
                    {
                        _pending.TryAdd(retryKey, (channel, now.AddSeconds(_debounceSec), sourcePath));
                    }
                }
                else
                {
                    _failures.Remove(retryKey);
                    _dropped++;
                }

                _log.Warn($"fs-egress event {path} not recorded (attempt {attempts}): {ex.Message}");
            }
        }
    }

    private void RefreshRoots(bool force)
    {
        var desired = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var path in FsEgressRoots.UniqueExisting(FsEgressRoots.RemovableRoots()))
        {
            desired[path] = "usb";
        }

        foreach (var path in FsEgressRoots.UniqueExisting(FsEgressRoots.RemoteRoots()))
        {
            desired[path] = "network";
        }

        if (_watchProfileDeletes)
        {
            foreach (var path in FsEgressRoots.UniqueExisting(FsEgressRoots.ProfileRoots()))
            {
                desired[path] = "profile_delete";
            }
        }

        foreach (var path in FsEgressRoots.UniqueExisting(_extraRoots))
        {
            desired[path] = "usb";
        }

        lock (_gate)
        {
            foreach (var key in _watchers.Keys.Where(key => !desired.ContainsKey(key)).ToList())
            {
                var watcher = _watchers[key];
                _watchers.Remove(key);
                try
                {
                    watcher.EnableRaisingEvents = false;
                    watcher.Dispose();
                }
                catch (Exception)
                {
                    // ignore
                }

                _log.Info($"fs_egress unwatch {key}");
            }
        }

        foreach (var (path, channel) in desired)
        {
            lock (_gate)
            {
                if (_watchers.ContainsKey(path))
                {
                    continue;
                }
            }

            try
            {
                var watcher = CreateWatcher(path, channel);
                lock (_gate)
                {
                    _watchers[path] = watcher;
                }

                watcher.EnableRaisingEvents = true;
                _log.Info($"fs_egress watch {path} ({channel})");
            }
            catch (Exception ex)
            {
                _log.Warn($"fs_egress failed to watch {path}: {ex.Message}");
            }
        }

        if (force && desired.Count == 0)
        {
            _log.Info("fs_egress: no USB/network/profile roots yet");
        }
    }

    private FileSystemWatcher CreateWatcher(string path, string channel)
    {
        var watcher = new FileSystemWatcher(path)
        {
            IncludeSubdirectories = true,
            InternalBufferSize = 64 * 1024,
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.Size,
        };

        if (channel == "profile_delete")
        {
            watcher.Deleted += (_, args) =>
            {
                if (!Directory.Exists(args.FullPath))
                {
                    Offer(args.FullPath, "deleted", "deleted");
                }
            };
            watcher.Renamed += (_, args) =>
            {
                if (Directory.Exists(args.FullPath))
                {
                    return;
                }

                if (args.FullPath.Contains("$recycle.bin", StringComparison.OrdinalIgnoreCase))
                {
                    Offer(args.OldFullPath, "deleted", "recycle", args.OldFullPath);
                }
            };
        }
        else
        {
            watcher.Created += (_, args) =>
            {
                if (!Directory.Exists(args.FullPath))
                {
                    Offer(args.FullPath, channel, "created");
                }
            };
            watcher.Renamed += (_, args) =>
            {
                if (!Directory.Exists(args.FullPath))
                {
                    Offer(args.FullPath, channel, "moved", args.OldFullPath);
                }
            };
        }

        watcher.Error += (_, args) =>
        {
            _log.Warn($"fs_egress watcher error on {path}: {args.GetException().Message}");
            lock (_gate)
            {
                if (_watchers.Remove(path, out var broken))
                {
                    try
                    {
                        broken.EnableRaisingEvents = false;
                        broken.Dispose();
                    }
                    catch (Exception)
                    {
                        // ignore
                    }
                }
            }
        };

        return watcher;
    }

    private static double ParseDouble(string? raw, double fallback)
    {
        var value = Text.Sanitize(raw).Replace(',', '.');
        return double.TryParse(value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var parsed)
            ? Math.Max(0, parsed)
            : fallback;
    }

    public void Dispose() => Stop();
}
