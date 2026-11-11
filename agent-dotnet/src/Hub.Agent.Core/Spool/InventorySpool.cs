using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Hub.Agent.Core.Configuration;
using Hub.Agent.Core.Diagnostics;
using Hub.Agent.Core.Support;

namespace Hub.Agent.Core.Spool;

/// <summary>
/// Durable inventory queue. The file layout, naming and item schema are
/// byte-compatible with the Python agent, so a downgrade can pick up the same
/// pending reports.
/// </summary>
public sealed class InventorySpool
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = false,
    };

    private readonly string _pendingDir;
    private readonly string _deadDir;
    private readonly AgentLog _log;

    public InventorySpool(AgentPaths paths, AgentLog log)
    {
        _pendingDir = paths.QueuePendingDir;
        _deadDir = paths.QueueDeadDir;
        _log = log;
        Directory.CreateDirectory(_pendingDir);
        Directory.CreateDirectory(_deadDir);
    }

    public IReadOnlyList<string> PendingPaths()
    {
        if (!Directory.Exists(_pendingDir))
        {
            return Array.Empty<string>();
        }

        return Directory.EnumerateFiles(_pendingDir, "*.json")
            .Where(File.Exists)
            .OrderBy(path => Path.GetFileName(path), StringComparer.Ordinal)
            .ToList();
    }

    public int PendingDepth() => PendingPaths().Count;

    public int DeadDepth()
    {
        if (!Directory.Exists(_deadDir))
        {
            return 0;
        }

        return Directory.EnumerateFiles(_deadDir, "*.json").Count(File.Exists);
    }

    public string Enqueue(JsonNode payload)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var id = Guid.NewGuid().ToString("N");
        var fileName = $"{now:D10}_{id}.json";
        var path = Path.Combine(_pendingDir, fileName);

        var item = new JsonObject
        {
            ["id"] = id,
            ["created_at"] = now,
            ["payload"] = payload.DeepClone(),
            ["attempts"] = 0,
            ["next_attempt_at"] = 0,
            ["last_error"] = string.Empty,
        };

        Write(path, item);
        return path;
    }

    public JsonObject? Read(string path)
    {
        try
        {
            var node = JsonNode.Parse(File.ReadAllText(path));
            if (node is not JsonObject item)
            {
                _log.Warn($"Inventory queue read failed ({path}): not a JSON object");
                return null;
            }

            item["id"] = Text.Sanitize(item["id"]?.ToString()).Length > 0
                ? Text.Sanitize(item["id"]?.ToString())
                : Path.GetFileNameWithoutExtension(path);
            item["created_at"] = Text.ToLong(item["created_at"], DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            item["attempts"] = Math.Max(0, Text.ToLong(item["attempts"], 0));
            item["next_attempt_at"] = Text.ToLong(item["next_attempt_at"], 0);
            item["last_error"] = Text.Sanitize(item["last_error"]?.ToString());
            return item;
        }
        catch (Exception ex)
        {
            _log.Warn($"Inventory queue read failed ({path}): {ex.Message}");
            return null;
        }
    }

    public void Write(string path, JsonObject item)
    {
        var directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        var temp = $"{path}.tmp.{Guid.NewGuid():N}";
        File.WriteAllText(temp, item.ToJsonString(JsonOptions));
        File.Move(temp, path, overwrite: true);
    }

    public void MoveToDead(string path, JsonObject? item, string reason)
    {
        var payload = item ?? new JsonObject();
        payload["dropped_reason"] = reason;
        payload["dropped_at"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        var deadPath = Path.Combine(_deadDir, Path.GetFileName(path));
        try
        {
            Write(deadPath, payload);
        }
        catch (Exception ex)
        {
            // keep the pending report: the server never acknowledged it
            _log.Warn($"Inventory dead-letter write failed, report kept in queue ({deadPath}): {ex.Message}");
            return;
        }

        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch (Exception ex)
        {
            _log.Warn($"Inventory queue delete failed ({path}): {ex.Message}");
        }
    }

    /// <summary>Applies age/count/size limits and returns the retry schedule by path.</summary>
    public Dictionary<string, long> Prune(AgentConfig config)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var maxAgeSeconds = config.InventoryQueueMaxAgeDays * 24L * 60 * 60;
        var maxTotalSize = (long)config.InventoryQueueMaxTotalMb * 1024 * 1024;
        var retrySchedule = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
        var entries = new List<(string Path, long Size)>();

        foreach (var path in PendingPaths())
        {
            long size;
            try
            {
                size = new FileInfo(path).Length;
            }
            catch (Exception)
            {
                size = 0;
            }

            var item = Read(path);
            if (item is null)
            {
                MoveToDead(path, null, "QUEUE_CORRUPT");
                continue;
            }

            retrySchedule[path] = Text.ToLong(item["next_attempt_at"], 0);
            var createdAt = Text.ToLong(item["created_at"], now);
            if (maxAgeSeconds > 0 && now - createdAt > maxAgeSeconds)
            {
                _log.Warn($"Inventory queue item expired by age: {Path.GetFileName(path)}");
                MoveToDead(path, item, "QUEUE_MAX_AGE");
                continue;
            }

            entries.Add((path, size));
        }

        var excessCount = entries.Count - config.InventoryQueueMaxItems;
        var totalSize = entries.Sum(entry => entry.Size);

        for (var index = 0; index < entries.Count; index++)
        {
            string limit;
            if (index < excessCount)
            {
                limit = "COUNT";
            }
            else if (totalSize > maxTotalSize)
            {
                limit = "SIZE";
            }
            else
            {
                break;
            }

            var (path, size) = entries[index];
            var item = Read(path);
            if (item is not null)
            {
                _log.Warn($"Inventory queue full by {limit.ToLowerInvariant()}, moving oldest to dead-letter: {Path.GetFileName(path)}");
                MoveToDead(path, item, $"QUEUE_FULL_{limit}");
            }

            totalSize -= size;
        }

        return retrySchedule;
    }

    public static long BackoffSeconds(int attempts)
    {
        var count = Math.Max(1, attempts);
        var baseDelay = Math.Min(3600, 5 * Math.Pow(2, Math.Min(count - 1, 10)));
        var jitter = Random.Shared.NextDouble() * 0.4 + 0.85;
        return Math.Max(5, (long)(baseDelay * jitter));
    }

    public static string FormatTimestamp(long unixSeconds)
        => unixSeconds.ToString("D10", CultureInfo.InvariantCulture);
}
