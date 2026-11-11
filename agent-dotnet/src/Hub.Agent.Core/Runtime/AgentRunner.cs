using System.Text.Json;
using System.Text.Json.Nodes;
using Hub.Agent.Core.BrowserProbe;
using Hub.Agent.Core.Configuration;
using Hub.Agent.Core.Diagnostics;
using Hub.Agent.Core.FsEgress;
using Hub.Agent.Core.Inventory;
using Hub.Agent.Core.Scan;
using Hub.Agent.Core.Spool;
using Hub.Agent.Core.Support;
using Hub.Agent.Core.Transport;

namespace Hub.Agent.Core.Runtime;

public sealed class AgentRunner : IDisposable
{
    private readonly AgentConfig _config;
    private readonly AgentPaths _paths;
    private readonly AgentLog _log;
    private readonly InventorySpool _spool;
    private readonly InventoryClient _client;
    private readonly FsEgressService _fsEgress;
    private readonly BrowserHistoryService _browserHistory;
    private readonly ScanAgentService _scanAgent;
    private readonly bool _allowNetwork;
    private bool _lastSendOk;

    public AgentRunner(AgentConfig config, AgentPaths paths, AgentLog log, bool allowSend = false)
    {
        _config = config;
        _paths = paths;
        _log = log;
        _allowNetwork = allowSend || AgentPaths.IsInstalledBuild;
        _spool = new InventorySpool(paths, log);
        _client = new InventoryClient(config, log);
        _fsEgress = new FsEgressService(config, paths, log);
        _browserHistory = new BrowserHistoryService(paths, log);
        _scanAgent = new ScanAgentService(paths, log);
    }

    public JsonObject Collect(bool fullSnapshot, string reportType)
        => InventoryCollector.Build(_config, _paths, _log, _spool, _fsEgress, _scanAgent.IsRunning, fullSnapshot, reportType);

    public async Task<bool> CheckConfigurationAsync(CancellationToken cancellationToken)
    {
        var ok = true;
        if (string.IsNullOrWhiteSpace(_config.ServerUrl))
        {
            _log.Error("SERVER_URL is empty");
            ok = false;
        }

        if (string.IsNullOrWhiteSpace(_config.ApiKey))
        {
            _log.Error("API_KEY is empty");
            ok = false;
        }

        if (!ok)
        {
            return false;
        }

        if (!Uri.TryCreate(_config.ServerUrl, UriKind.Absolute, out var uri))
        {
            _log.Error($"SERVER_URL is not a valid absolute URI: {_config.ServerUrl}");
            return false;
        }

        if (!string.Equals(uri.Scheme, "https", StringComparison.OrdinalIgnoreCase))
        {
            _log.Warn($"SERVER_URL is not HTTPS: {_config.ServerUrl}");
        }

        try
        {
            var addresses = await System.Net.Dns.GetHostAddressesAsync(uri.Host, cancellationToken).ConfigureAwait(false);
            _log.Info($"DNS resolve host={uri.Host} -> {string.Join(", ", addresses.Take(6).Select(item => item.ToString()))}");
        }
        catch (Exception ex)
        {
            _log.Error($"DNS resolve failed for {uri.Host}: {ex.Message}");
            return false;
        }

        if (!await _client.CheckHealthAsync(cancellationToken).ConfigureAwait(false))
        {
            return false;
        }

        return await _client.ProbeAuthorizationAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<int> RunOnceAsync(CancellationToken cancellationToken)
    {
        var startedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var payload = Collect(fullSnapshot: true, reportType: "full_snapshot");
        MaybeNotifyReboot(payload);
        var sent = await SendDataAsync(payload, cancellationToken).ConfigureAwait(false);

        WriteStatus(new Dictionary<string, object?>
        {
            ["last_inventory_ok_at"] = sent ? DateTimeOffset.UtcNow.ToUnixTimeSeconds() : null,
            ["inventory_queue_depth"] = _spool.PendingDepth(),
            ["scan_outbox_depth"] = CountJson(_paths.ScanOutboxPendingDir),
            ["last_scan_ingest_ok_at"] = ReadScanLastIngest(),
            ["last_error"] = sent ? string.Empty : "INVENTORY_SEND_FAILED",
            ["version"] = AgentVersion.Value,
            ["uptime_sec"] = Math.Max(0, DateTimeOffset.UtcNow.ToUnixTimeSeconds() - startedAt),
            ["updated_at"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
        });

        return sent ? 0 : 1;
    }

    public async Task<int> RunLoopAsync(CancellationToken cancellationToken)
    {
        var startedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        long nextFullSnapshotAt = 0;
        long lastStatusWriteAt = 0;
        var lastInventoryOkAt = (long?)null;
        var lastError = string.Empty;

        if (_allowNetwork)
        {
            _fsEgress.Start();
            _browserHistory.Start();
            _scanAgent.Start();
        }
        else
        {
            _log.Info("Sidecars are not started in a development build without --allow-send");
        }
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var includeFullSnapshot = now >= nextFullSnapshotAt;
            var reportType = includeFullSnapshot ? "full_snapshot" : "heartbeat";

            try
            {
                var payload = Collect(includeFullSnapshot, reportType);
                MaybeNotifyReboot(payload);
                var sent = await SendDataAsync(payload, cancellationToken).ConfigureAwait(false);
                if (sent)
                {
                    lastInventoryOkAt = now;
                    lastError = string.Empty;
                }
                else
                {
                    lastError = "INVENTORY_SEND_FAILED";
                }

                if (includeFullSnapshot)
                {
                    nextFullSnapshotAt = sent
                        ? now + _config.FullSnapshotIntervalSec
                        : now + Math.Min(_config.HeartbeatIntervalSec, 300);
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _log.Exception("Unexpected error in main loop", ex);
                lastError = $"MAIN_LOOP_ERROR:{ex.GetType().Name}";
                if (includeFullSnapshot && nextFullSnapshotAt == 0)
                {
                    nextFullSnapshotAt = now + Math.Min(_config.HeartbeatIntervalSec, 300);
                }
            }

            if (now - lastStatusWriteAt >= 30)
            {
                WriteStatus(new Dictionary<string, object?>
                {
                    ["last_inventory_ok_at"] = lastInventoryOkAt,
                    ["inventory_queue_depth"] = _spool.PendingDepth(),
                    ["scan_outbox_depth"] = CountJson(_paths.ScanOutboxPendingDir),
                    ["last_scan_ingest_ok_at"] = ReadScanLastIngest(),
                    ["last_error"] = lastError,
                    ["version"] = AgentVersion.Value,
                    ["uptime_sec"] = Math.Max(0, DateTimeOffset.UtcNow.ToUnixTimeSeconds() - startedAt),
                    ["updated_at"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                });
                lastStatusWriteAt = now;
            }

            var sleepSeconds = _config.HeartbeatIntervalSec + Random.Shared.Next(0, _config.HeartbeatJitterSec + 1);
            _log.Info($"Sleeping {sleepSeconds} seconds before next cycle");
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(sleepSeconds), cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            }
        }
        finally
        {
            _scanAgent.Stop();
            _browserHistory.Stop();
            _fsEgress.Stop();
        }
        return 0;
    }

    private void MaybeNotifyReboot(JsonObject payload)
    {
        var uptime = Text.ToLong(payload["uptime_seconds"], -1);
        var bootTime = Text.ToLong(payload["last_reboot_at"], 0);
        RebootReminder.MaybeNotify(uptime, bootTime, _config, _paths, _log);
    }

    private async Task<bool> SendDataAsync(JsonObject payload, CancellationToken cancellationToken)
    {
        string enqueuedPath;
        try
        {
            enqueuedPath = _spool.Enqueue(payload);
        }
        catch (Exception ex)
        {
            _log.Error($"Inventory queue enqueue failed: {ex.Message}");
            return false;
        }

        var retrySchedule = _spool.Prune(_config);
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var queuePaths = _spool.PendingPaths().ToList();
        if (queuePaths.Remove(enqueuedPath))
        {
            queuePaths.Insert(0, enqueuedPath);
        }

        var backlogRemaining = Math.Max(0, _config.InventoryQueueBatch);
        var sentCurrent = false;

        foreach (var path in queuePaths)
        {
            var isCurrent = string.Equals(path, enqueuedPath, StringComparison.OrdinalIgnoreCase);
            if (!isCurrent && backlogRemaining == 0)
            {
                break;
            }

            if (retrySchedule.TryGetValue(path, out var scheduledAt) && scheduledAt > now)
            {
                continue;
            }

            var item = _spool.Read(path);
            if (item is null)
            {
                _spool.MoveToDead(path, null, "QUEUE_CORRUPT");
                continue;
            }

            if (Text.ToLong(item["next_attempt_at"], 0) > now)
            {
                continue;
            }

            if (item["payload"] is not JsonObject payloadNode)
            {
                _spool.MoveToDead(path, item, "QUEUE_INVALID_PAYLOAD");
                continue;
            }

            if (!isCurrent)
            {
                backlogRemaining--;
            }

            var result = await _client.PostAsync(payloadNode, cancellationToken).ConfigureAwait(false);
            if (result.Success)
            {
                try
                {
                    File.Delete(path);
                }
                catch (Exception ex)
                {
                    _log.Warn($"Inventory queue delete after ACK failed ({path}): {ex.Message}");
                }

                if (isCurrent)
                {
                    sentCurrent = true;
                }

                continue;
            }

            var attempts = (int)Text.ToLong(item["attempts"], 0) + 1;
            item["attempts"] = attempts;
            item["next_attempt_at"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds() + InventorySpool.BackoffSeconds(attempts);
            item["last_error"] = string.IsNullOrEmpty(result.Error) ? "NET_TIMEOUT_OR_HTTP_ERROR" : result.Error;
            try
            {
                _spool.Write(path, item);
            }
            catch (Exception ex)
            {
                _log.Warn($"Inventory queue rewrite failed ({path}): {ex.Message}");
            }

            if (isCurrent)
            {
                break;
            }
        }

        _lastSendOk = sentCurrent;
        return sentCurrent;
    }

    private void WriteStatus(Dictionary<string, object?> payload)
    {
        try
        {
            AtomicFile.WriteAllText(_paths.StatusFile, JsonSerializer.Serialize(payload));
        }
        catch (Exception ex)
        {
            _log.Debug($"Agent status write failed ({_paths.StatusFile}): {ex.Message}");
        }
    }

    private long? ReadScanLastIngest()
    {
        try
        {
            if (!File.Exists(_paths.ScanAgentStatusFile))
            {
                return null;
            }

            using var document = System.Text.Json.JsonDocument.Parse(File.ReadAllText(_paths.ScanAgentStatusFile));
            if (document.RootElement.TryGetProperty("last_ingest_ok_at", out var value)
                && value.TryGetInt64(out var parsed) && parsed > 0)
            {
                return parsed;
            }
        }
        catch (Exception)
        {
            // status file missing or corrupt
        }

        return null;
    }

    private static int CountJson(string directory)
    {
        try
        {
            return Directory.Exists(directory) ? Directory.EnumerateFiles(directory, "*.json").Count() : 0;
        }
        catch (Exception)
        {
            return 0;
        }
    }

    public bool LastSendOk => _lastSendOk;

    public void Dispose()
    {
        _client.Dispose();
        _scanAgent.Dispose();
        _browserHistory.Dispose();
        _fsEgress.Dispose();
    }
}
