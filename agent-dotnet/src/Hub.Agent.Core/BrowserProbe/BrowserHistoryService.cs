using System.Text.Json;
using System.Text.Json.Nodes;
using Hub.Agent.Core.Diagnostics;
using Hub.Agent.Core.Support;

namespace Hub.Agent.Core.BrowserProbe;

/// <summary>
/// History-only browser collector for the SYSTEM agent. The interactive
/// foreground/screenshot probe stays a separate product; this mirrors
/// browser_probe/history_agent.py and is off by default.
/// </summary>
public sealed class BrowserHistoryService : IDisposable
{
    private readonly AgentLog _log;
    private readonly string _outputDir;
    private readonly double _intervalSec;
    private readonly string _usersRoot;
    private readonly BrowserProbeSync? _sync = null;
    private readonly Dictionary<string, long> _cursors = new(StringComparer.Ordinal);
    private CancellationTokenSource? _cancellation;
    private Task? _loop;

    public BrowserHistoryService(AgentPaths paths, AgentLog log, string? usersRoot = null, bool? enabledOverride = null)
    {
        _log = log;
        Enabled = enabledOverride ?? Text.Truthy(Environment.GetEnvironmentVariable("ITINV_BROWSER_HISTORY_ENABLED"), false);
        _usersRoot = usersRoot ?? Path.Combine(Environment.GetEnvironmentVariable("SystemDrive") ?? "C:", "Users");
        _intervalSec = Math.Max(30, Text.ToInt(Environment.GetEnvironmentVariable("ITINV_BROWSER_HISTORY_SEC"), 180));

        var output = Text.Sanitize(Environment.GetEnvironmentVariable("ITINV_BROWSER_HISTORY_OUTPUT"));
        _outputDir = output.Length > 0 ? output : Path.Combine(paths.AgentRoot, "BrowserHistory");
        if (Enabled)
        {
            Directory.CreateDirectory(_outputDir);
        }

        LoadState();

        if (!Enabled)
        {
            return;
        }

        var serverUrl = Text.Sanitize(Environment.GetEnvironmentVariable("ITINV_BROWSER_PROBE_SERVER_URL"));
        if (serverUrl.Length == 0)
        {
            serverUrl = Text.Sanitize(Environment.GetEnvironmentVariable("ITINV_AGENT_SERVER_URL"));
        }

        var apiKey = Text.Sanitize(Environment.GetEnvironmentVariable("ITINV_AGENT_API_KEY"));
        if (apiKey.Length == 0)
        {
            apiKey = Text.Sanitize(Environment.GetEnvironmentVariable("SCAN_AGENT_API_KEY"));
        }

        var syncInterval = Text.ToInt(Environment.GetEnvironmentVariable("ITINV_BROWSER_PROBE_SYNC_SEC"), 120);
        _sync = new BrowserProbeSync(_outputDir, serverUrl, apiKey, syncInterval, log);    }

    public bool Enabled { get; }

    public bool IsRunning => _loop is { IsCompleted: false };

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
            // best effort
        }
        finally
        {
            _cancellation?.Dispose();
            _cancellation = null;
            _loop = null;
        }
    }

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        _log.Info($"browser history collector start interval={_intervalSec}s output={_outputDir}");
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                var collected = CollectOnce();
                if (collected > 0)
                {
                    _log.Info($"browser history collected {collected} visits");
                }

                if (_sync is not null)
                {
                    await _sync.MaybeSyncAsync(force: false, cancellationToken).ConfigureAwait(false);
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _log.Exception("browser history cycle failed", ex);
            }

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(_intervalSec), cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        if (_sync is not null)
        {
            try
            {
                await _sync.MaybeSyncAsync(force: true, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception)
            {
                // shutdown best effort
            }
        }
    }

    public int CollectOnce()
    {
        var profiles = BrowserHistory.DiscoverAllUsers(_usersRoot);
        if (profiles.Count == 0)
        {
            return 0;
        }

        var workDir = Path.Combine(_outputDir, "hist_tmp");
        var changed = false;
        foreach (var profile in profiles.Where(profile => !_cursors.ContainsKey(profile.CursorKey)))
        {
            _cursors[profile.CursorKey] = BrowserHistory.LatestVisitId(profile, workDir);
            changed = true;
        }

        var visitsByUser = new Dictionary<string, List<Dictionary<string, object?>>>(StringComparer.OrdinalIgnoreCase);
        foreach (var profile in profiles)
        {
            var since = _cursors.GetValueOrDefault(profile.CursorKey, 0);
            var batch = BrowserHistory.ReadVisitsSince(profile, since, 400, workDir);
            if (batch.Cursor > since)
            {
                _cursors[profile.CursorKey] = batch.Cursor;
                changed = true;
            }

            if (batch.NoiseOnly || batch.Rows.Count == 0)
            {
                continue;
            }

            var user = Text.Sanitize(profile.WindowsUser);
            foreach (var row in batch.Rows)
            {
                row["windows_user"] = user;
                if (user.Length > 0)
                {
                    row["profile"] = $"{user}@{Text.Sanitize(row.GetValueOrDefault("profile"))}";
                }

                var bucket = user.Length > 0 ? user : "unknown";
                if (!visitsByUser.TryGetValue(bucket, out var list))
                {
                    list = new List<Dictionary<string, object?>>();
                    visitsByUser[bucket] = list;
                }

                list.Add(row);
            }
        }

        if (changed)
        {
            SaveState();
        }

        var total = visitsByUser.Values.Sum(rows => rows.Count);
        if (_sync is not null && visitedAny(visitsByUser))
        {
            var computer = Text.Sanitize(Environment.GetEnvironmentVariable("COMPUTERNAME"));
            foreach (var (user, rows) in visitsByUser)
            {
                _sync.Enqueue(new Dictionary<string, object?>
                {
                    ["computer_name"] = computer,
                    ["windows_user"] = user == "unknown" ? string.Empty : user,
                    ["visits"] = rows,
                    ["focus_events"] = new List<Dictionary<string, object?>>(),
                    ["screenshots"] = new List<Dictionary<string, object?>>(),
                });
            }
        }

        return total;

        static bool visitedAny(Dictionary<string, List<Dictionary<string, object?>>> map)
            => map.Values.Any(rows => rows.Count > 0);
    }

    private string StatePath => Path.Combine(_outputDir, "state.json");

    private void LoadState()
    {
        try
        {
            if (!File.Exists(StatePath))
            {
                return;
            }

            var node = JsonNode.Parse(File.ReadAllText(StatePath));
            if (node is not JsonObject obj || obj["visit_cursors"] is not JsonObject cursors)
            {
                return;
            }

            foreach (var pair in cursors)
            {
                if (long.TryParse(pair.Value?.ToString(), out var value))
                {
                    _cursors[pair.Key] = value;
                }
            }
        }
        catch (Exception)
        {
            _cursors.Clear();
        }
    }

    private void SaveState()
    {
        try
        {
            var state = new JsonObject
            {
                ["computer_name"] = Text.Sanitize(Environment.GetEnvironmentVariable("COMPUTERNAME")),
                ["visit_cursors"] = JsonSerializer.SerializeToNode(_cursors),
                ["updated_at"] = DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.ffffff'Z'"),
            };
            AtomicFile.WriteAllText(StatePath, state.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception ex)
        {
            _log.Warn($"browser history state write failed: {ex.Message}");
        }
    }

    public void Dispose() => Stop();
}
