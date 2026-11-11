using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Hub.Agent.Core.Diagnostics;
using Hub.Agent.Core.Support;

namespace Hub.Agent.Core.FsEgress;

public sealed record FsEgressStats(int Pending, int DeadLetter, long? LastSentAt);

/// <summary>Durable queue for file-left events (parity with fs_egress/spool.py).</summary>
public sealed class FsEgressSpool
{
    private readonly string _pendingDir;
    private readonly string _sentDir;
    private readonly string _deadDir;
    private readonly string _inboxDir;
    private readonly string _serverUrl;
    private readonly string _apiKey;
    private readonly int _maxPending;
    private readonly int _maxAgeDays;
    private readonly AgentLog _log;
    private readonly HttpClient _http;

    public FsEgressSpool(
        string root,
        string serverUrl,
        string apiKey,
        AgentLog log,
        int maxPending = 5000,
        int maxAgeDays = 14)
    {
        Root = root;
        _pendingDir = Path.Combine(root, "pending");
        _sentDir = Path.Combine(root, "sent");
        _deadDir = Path.Combine(root, "dead_letter");
        _inboxDir = Path.Combine(root, "inbox");
        foreach (var folder in new[] { _pendingDir, _sentDir, _deadDir, _inboxDir })
        {
            Directory.CreateDirectory(folder);
        }

        _serverUrl = (serverUrl ?? string.Empty).TrimEnd('/');
        _apiKey = (apiKey ?? string.Empty).Trim();
        _maxPending = maxPending;
        _maxAgeDays = maxAgeDays;
        _log = log;
        _http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
    }

    public string Root { get; }

    public string Enqueue(Dictionary<string, object?> evt)
    {
        Prune();
        var id = Text.Sanitize(evt.GetValueOrDefault("event_id"));
        if (id.Length == 0)
        {
            id = Guid.NewGuid().ToString("N");
        }

        var payload = new Dictionary<string, object?>(evt) { ["event_id"] = id };
        var path = Path.Combine(_pendingDir, $"{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}_{id}.json");
        AtomicFile.WriteAllText(path, JsonSerializer.Serialize(payload));
        return path;
    }

    public FsEgressStats Stats()
    {
        var lastSent = Directory.Exists(_sentDir)
            ? Directory.EnumerateFiles(_sentDir, "*.json")
                .Select(path => new DateTimeOffset(File.GetLastWriteTimeUtc(path)).ToUnixTimeSeconds())
                .DefaultIfEmpty(0)
                .Max()
            : 0;
        return new FsEgressStats(
            CountJson(_pendingDir),
            CountJson(_deadDir),
            lastSent > 0 ? lastSent : null);
    }

    public async Task<FsEgressStats> DrainAsync(int batchSize, CancellationToken cancellationToken)
    {
        IngestInbox();
        var stats = new FsEgressStats(0, 0, null);
        if (_serverUrl.Length == 0 || _apiKey.Length == 0)
        {
            return stats;
        }

        var files = Directory.Exists(_pendingDir)
            ? Directory.EnumerateFiles(_pendingDir, "*.json")
                .OrderBy(path => Path.GetFileName(path), StringComparer.Ordinal)
                .Take(Math.Max(1, batchSize))
                .ToList()
            : new List<string>();
        if (files.Count == 0)
        {
            return stats;
        }

        var events = new List<JsonNode?>();
        var paths = new List<string>();
        var dead = 0;
        foreach (var path in files)
        {
            try
            {
                var node = JsonNode.Parse(File.ReadAllText(path));
                if (node is JsonObject)
                {
                    events.Add(node);
                    paths.Add(path);
                    continue;
                }
            }
            catch (Exception)
            {
                // corrupt item: move to dead letter below
            }

            if (Move(path, _deadDir))
            {
                dead++;
            }
        }

        if (events.Count == 0)
        {
            return stats with { DeadLetter = dead };
        }

        var body = new JsonObject { ["events"] = new JsonArray(events.ToArray()) }.ToJsonString();
        var ok = await PostAsync(body, cancellationToken).ConfigureAwait(false);
        if (!ok)
        {
            return stats with { DeadLetter = dead };
        }

        var sent = 0;
        foreach (var path in paths)
        {
            if (!Move(path, _sentDir))
            {
                // The server already has the event; keeping it pending would only resend it.
                try
                {
                    File.Delete(path);
                }
                catch (Exception)
                {
                    // best effort
                }
            }

            sent++;
        }

        return new FsEgressStats(sent, dead, null);
    }

    private void IngestInbox()
    {
        if (!Directory.Exists(_inboxDir))
        {
            return;
        }

        foreach (var path in Directory.EnumerateFiles(_inboxDir, "*.json").OrderBy(path => Path.GetFileName(path), StringComparer.Ordinal).ToList())
        {
            try
            {
                var node = JsonNode.Parse(File.ReadAllText(path));
                if (node is JsonObject obj)
                {
                    Enqueue(ToDictionary(obj));
                }

                File.Delete(path);
            }
            catch (Exception ex)
            {
                _log.Warn($"Failed to ingest fs_egress inbox {path}: {ex.Message}");
            }
        }
    }

    private async Task<bool> PostAsync(string body, CancellationToken cancellationToken)
    {
        var url = _serverUrl;
        if (url.EndsWith("/inventory", StringComparison.OrdinalIgnoreCase))
        {
            url += "/fs-egress";
        }
        else if (!url.EndsWith("/fs-egress", StringComparison.OrdinalIgnoreCase))
        {
            url = url.TrimEnd('/') + "/fs-egress";
        }

        var timeoutSeconds = Math.Max(60.0, body.Length / (256.0 * 1024) * 60.0);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(timeoutSeconds));

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            };
            request.Headers.Add("X-API-Key", _apiKey);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

            using var response = await _http.SendAsync(request, timeout.Token).ConfigureAwait(false);
            if ((int)response.StatusCode >= 400)
            {
                _log.Warn($"fs-egress POST {url} -> {(int)response.StatusCode}");
                return false;
            }

            return true;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _log.Warn($"fs-egress POST failed: {ex.Message}");
            return false;
        }
    }

    private void Prune()
    {
        try
        {
            var pending = Directory.EnumerateFiles(_pendingDir, "*.json")
                .Select(path => (Path: path, Modified: File.GetLastWriteTimeUtc(path)))
                .OrderBy(item => item.Modified)
                .ToList();

            var excess = pending.Count - _maxPending;
            for (var index = 0; index < excess; index++)
            {
                Move(pending[index].Path, _deadDir);
            }

            var cutoff = DateTime.UtcNow.AddDays(-_maxAgeDays);
            foreach (var folder in new[] { _sentDir, _deadDir })
            {
                foreach (var path in Directory.EnumerateFiles(folder, "*.json"))
                {
                    try
                    {
                        if (File.GetLastWriteTimeUtc(path) < cutoff)
                        {
                            File.Delete(path);
                        }
                    }
                    catch (Exception)
                    {
                        // skip
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _log.Debug($"fs_egress spool prune failed: {ex.Message}");
        }
    }

    private bool Move(string source, string destinationDir)
    {
        try
        {
            Directory.CreateDirectory(destinationDir);
            var target = Path.Combine(destinationDir, Path.GetFileName(source));
            if (File.Exists(target))
            {
                File.Delete(target);
            }

            File.Move(source, target);
            return File.Exists(target) && !File.Exists(source);
        }
        catch (Exception ex)
        {
            _log.Warn($"fs-egress move {source} -> {destinationDir} failed, event kept: {ex.Message}");
            return false;
        }
    }

    private static int CountJson(string folder)
    {
        try
        {
            return Directory.Exists(folder) ? Directory.EnumerateFiles(folder, "*.json").Count() : 0;
        }
        catch (Exception)
        {
            return 0;
        }
    }

    private static Dictionary<string, object?> ToDictionary(JsonObject obj)
    {
        var result = new Dictionary<string, object?>();
        foreach (var pair in obj)
        {
            result[pair.Key] = FromNode(pair.Value);
        }

        return result;
    }

    private static object? FromNode(JsonNode? node) => node switch
    {
        null => null,
        JsonObject obj => ToDictionary(obj),
        JsonArray array => array.Select(FromNode).ToList(),
        JsonValue value when value.TryGetValue<long>(out var number) => number,
        JsonValue value when value.TryGetValue<bool>(out var flag) => flag,
        JsonValue value => value.ToString(),
        _ => null,
    };
}
