using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Hub.Agent.Core.Diagnostics;
using Hub.Agent.Core.Support;

namespace Hub.Agent.Core.BrowserProbe;

/// <summary>
/// Upload queue for browser history (parity with browser_probe/sync.py).
/// History-only payloads: visits, no focus events and no screenshots.
/// </summary>
public sealed class BrowserProbeSync
{
    private const int MaxVisitsInQueue = 2000;
    private const int MaxFocusInQueue = 1000;
    private const int MaxScreenshotsInQueue = 200;
    private const int MaxBatchVisits = 500;
    private const int MaxBatchMedia = 20;
    private const long MaxMediaBytes = 8L * 1024 * 1024;

    private readonly string _outputDir;
    private readonly string _serverUrl;
    private readonly string _apiKey;
    private readonly double _intervalSec;
    private readonly AgentLog _log;
    private readonly HttpClient _http = new() { Timeout = Timeout.InfiniteTimeSpan };
    private readonly object _queueGate = new();
    private readonly SemaphoreSlim _syncGate = new(1, 1);
    private DateTime _lastSync = DateTime.MinValue;

    public BrowserProbeSync(string outputDir, string serverUrl, string apiKey, double intervalSec, AgentLog log)
    {
        _outputDir = outputDir;
        _serverUrl = (serverUrl ?? string.Empty).TrimEnd('/');
        _apiKey = (apiKey ?? string.Empty).Trim();
        _intervalSec = Math.Max(30, intervalSec);
        _log = log;
        Directory.CreateDirectory(_outputDir);
    }

    private string PendingPath => Path.Combine(_outputDir, "pending_upload.json");
    private string InflightPath => Path.Combine(_outputDir, "inflight_upload.json");

    public void Enqueue(IReadOnlyDictionary<string, object?> payload)
    {
        lock (_queueGate)
        {
            var pending = ReadQueue(PendingPath);
            foreach (var key in new[] { "visits", "focus_events", "screenshots" })
            {
                if (payload.TryGetValue(key, out var value) && value is List<Dictionary<string, object?>> items)
                {
                    ((List<Dictionary<string, object?>>)pending[key]!).AddRange(items);
                }
            }

            foreach (var key in new[] { "computer_name", "windows_user" })
            {
                var value = Text.Sanitize(payload.GetValueOrDefault(key));
                if (value.Length > 0)
                {
                    pending[key] = value;
                }
            }

            Trim(pending["visits"], MaxVisitsInQueue);
            Trim(pending["focus_events"], MaxFocusInQueue);
            Trim(pending["screenshots"], MaxScreenshotsInQueue);
            WriteQueue(PendingPath, pending);
        }
    }

    public async Task<int> MaybeSyncAsync(bool force, CancellationToken cancellationToken)
    {
        if (!force && (DateTime.UtcNow - _lastSync).TotalSeconds < _intervalSec)
        {
            return 0;
        }

        if (!await _syncGate.WaitAsync(force ? Timeout.InfiniteTimeSpan : TimeSpan.Zero, cancellationToken).ConfigureAwait(false))
        {
            return 0;
        }

        try
        {
            var sent = await SyncPendingAsync(cancellationToken).ConfigureAwait(false);
            _lastSync = DateTime.UtcNow;
            return sent;
        }
        catch (Exception ex)
        {
            _log.Warn($"browser probe sync failed: {ex.Message}");
            return 0;
        }
        finally
        {
            _syncGate.Release();
        }
    }

    private async Task<int> SyncPendingAsync(CancellationToken cancellationToken)
    {
        if (_serverUrl.Length == 0 || _apiKey.Length == 0)
        {
            return 0;
        }

        // Recover an interrupted snapshot, then pick up pending data once.
        for (var pass = 0; pass < 2; pass++)
        {
            lock (_queueGate)
            {
                if (!File.Exists(InflightPath))
                {
                    if (!File.Exists(PendingPath))
                    {
                        break;
                    }

                    File.Move(PendingPath, InflightPath, overwrite: true);
                }
            }

            var pending = ReadQueue(InflightPath);
            var visits = (List<Dictionary<string, object?>>)pending["visits"]!;
            var screenshots = (List<Dictionary<string, object?>>)pending["screenshots"]!;
            if (visits.Count == 0 && screenshots.Count == 0)
            {
                TryDelete(InflightPath);
                continue;
            }

            var sentTotal = 0;
            while ((visits.Count > 0 || screenshots.Count > 0) && !cancellationToken.IsCancellationRequested)
            {
                var batch = visits.Take(MaxBatchVisits).ToList();
                var media = new List<(Dictionary<string, object?> Row, byte[] Bytes, string Name)>();
                foreach (var shot in screenshots.Take(MaxBatchMedia))
                {
                    var encoded = EncodeScreenshot(shot);
                    if (encoded is null)
                    {
                        // Missing or oversized file: drop the row instead of blocking the queue.
                        screenshots.Remove(shot);
                        continue;
                    }

                    media.Add(encoded.Value);
                }

                if (batch.Count == 0 && media.Count == 0)
                {
                    WriteQueue(InflightPath, pending);
                    break;
                }

                var result = await PostBatchAsync(pending, batch, media, cancellationToken).ConfigureAwait(false);
                if (!result.Success)
                {
                    WriteQueue(InflightPath, pending);
                    return sentTotal;
                }

                visits.RemoveRange(0, batch.Count);
                foreach (var item in media)
                {
                    screenshots.Remove(item.Row);
                    ArchiveConfirmed(item.Name);
                }

                sentTotal += batch.Count + media.Count;
                WriteQueue(InflightPath, pending);
            }

            TryDelete(InflightPath);
            return sentTotal;
        }

        return 0;
    }

    private async Task<(bool Success, int Sent)> PostBatchAsync(
        Dictionary<string, object?> pending,
        List<Dictionary<string, object?>> visits,
        List<(Dictionary<string, object?> Row, byte[] Bytes, string Name)> media,
        CancellationToken cancellationToken)
    {
        var mediaNodes = new JsonArray();
        foreach (var item in media)
        {
            mediaNodes.Add(new JsonObject
            {
                ["name"] = item.Name,
                ["content_type"] = ContentType(item.Name),
                ["content_base64"] = Convert.ToBase64String(item.Bytes),
            });
        }

        var body = new JsonObject
        {
            ["computer_name"] = Text.Sanitize(pending.GetValueOrDefault("computer_name")),
            ["windows_user"] = Text.Sanitize(pending.GetValueOrDefault("windows_user")),
            ["visits"] = JsonSerializer.SerializeToNode(visits),
            ["focus_events"] = new JsonArray(),
            ["media"] = mediaNodes,
        }.ToJsonString();

        var url = UploadUrl();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(Math.Max(60, body.Length / (256.0 * 1024) * 60)));

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            };
            request.Headers.Add("X-API-Key", _apiKey);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

            using var response = await _http.SendAsync(request, timeout.Token).ConfigureAwait(false);
            if ((int)response.StatusCode is < 200 or >= 300)
            {
                _log.Warn($"browser-probe upload HTTP {(int)response.StatusCode}");
                return (false, 0);
            }

            var text = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            using var document = JsonDocument.Parse(text);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object ||
                !root.TryGetProperty("success", out var success) ||
                success.ValueKind != JsonValueKind.True)
            {
                _log.Warn("browser-probe upload was not acknowledged");
                return (false, 0);
            }

            if (root.TryGetProperty("media", out var mediaCount))
            {
                var acknowledged = mediaCount.TryGetInt32(out var count) ? count : 0;
                if (acknowledged != media.Count)
                {
                    _log.Warn($"browser-probe acknowledgement media count {acknowledged} != {media.Count}");
                    return (false, 0);
                }
            }
            else if (media.Count > 0)
            {
                _log.Warn("browser-probe acknowledgement is missing the media count");
                return (false, 0);
            }

            _log.Info($"browser batch acknowledged bytes={body.Length} visits={visits.Count} media={media.Count}");
            return (true, visits.Count + media.Count);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _log.Warn($"browser-probe upload failed: {ex.Message}");
            return (false, 0);
        }
    }

    private (Dictionary<string, object?> Row, byte[] Bytes, string Name)? EncodeScreenshot(Dictionary<string, object?> shot)
    {
        var relative = Text.Sanitize(shot.GetValueOrDefault("file")).Replace('\\', '/');
        if (relative.Length == 0)
        {
            return null;
        }

        var name = relative.Split('/')[^1];
        if (name.Length == 0)
        {
            return null;
        }

        var path = Path.Combine(_outputDir, "screenshots", name);
        if (!File.Exists(path))
        {
            path = Path.Combine(_outputDir, relative.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(path))
            {
                return null;
            }
        }

        try
        {
            if (new FileInfo(path).Length > MaxMediaBytes)
            {
                _log.Debug($"skip screenshot {name} exceeding {MaxMediaBytes} bytes");
                return null;
            }

            return (shot, File.ReadAllBytes(path), name);
        }
        catch (Exception)
        {
            return null;
        }
    }

    private void ArchiveConfirmed(string name)
    {
        try
        {
            var source = Path.Combine(_outputDir, "screenshots", name);
            if (!File.Exists(source))
            {
                return;
            }

            var directory = Path.Combine(_outputDir, "screenshots", "confirmed");
            Directory.CreateDirectory(directory);
            var destination = Path.Combine(directory, name);
            if (!File.Exists(destination))
            {
                File.Move(source, destination);
            }
        }
        catch (Exception ex)
        {
            _log.Warn($"browser probe could not archive confirmed screenshot: {ex.Message}");
        }
    }

    private static string ContentType(string name) => Path.GetExtension(name).ToLowerInvariant() switch
    {
        ".jpg" or ".jpeg" => "image/jpeg",
        ".webp" => "image/webp",
        _ => "image/png",
    };

    private string UploadUrl()
    {
        var baseUrl = _serverUrl;
        if (baseUrl.EndsWith("/inventory", StringComparison.OrdinalIgnoreCase))
        {
            return baseUrl + "/browser-probe";
        }

        return baseUrl.EndsWith("/browser-probe", StringComparison.OrdinalIgnoreCase)
            ? baseUrl
            : baseUrl.TrimEnd('/') + "/browser-probe";
    }

    private Dictionary<string, object?> ReadQueue(string path)
    {
        var result = new Dictionary<string, object?>
        {
            ["visits"] = new List<Dictionary<string, object?>>(),
            ["focus_events"] = new List<Dictionary<string, object?>>(),
            ["screenshots"] = new List<Dictionary<string, object?>>(),
        };

        try
        {
            if (!File.Exists(path))
            {
                return result;
            }

            var node = JsonNode.Parse(File.ReadAllText(path));
            if (node is not JsonObject obj)
            {
                return result;
            }

            foreach (var pair in obj)
            {
                result[pair.Key] = pair.Key switch
                {
                    "visits" or "focus_events" or "screenshots" => ToList(pair.Value),
                    _ => pair.Value?.ToString(),
                };
            }
        }
        catch (Exception)
        {
            // corrupt queue: start empty rather than loop forever
        }

        return result;
    }

    private void WriteQueue(string path, Dictionary<string, object?> pending)
    {
        var json = JsonSerializer.Serialize(pending);
        AtomicFile.WriteAllText(path, json);
    }

    private static List<Dictionary<string, object?>> ToList(JsonNode? node)
    {
        var list = new List<Dictionary<string, object?>>();
        if (node is not JsonArray array)
        {
            return list;
        }

        foreach (var item in array)
        {
            if (item is JsonObject obj)
            {
                list.Add(ToDictionary(obj));
            }
        }

        return list;
    }

    private static Dictionary<string, object?> ToDictionary(JsonObject obj)
    {
        var result = new Dictionary<string, object?>();
        foreach (var pair in obj)
        {
            result[pair.Key] = pair.Value switch
            {
                null => null,
                JsonObject nested => ToDictionary(nested),
                JsonArray array => array.Select(value => value?.ToString()).ToList(),
                JsonValue value when value.TryGetValue<long>(out var number) => number,
                JsonValue value when value.TryGetValue<bool>(out var flag) => flag,
                JsonValue value => value.ToString(),
                _ => null,
            };
        }

        return result;
    }

    private static void Trim(object? list, int limit)
    {
        if (list is List<Dictionary<string, object?>> items && items.Count > limit)
        {
            items.RemoveRange(0, items.Count - limit);
        }
    }

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception)
        {
            // best effort
        }
    }
}
