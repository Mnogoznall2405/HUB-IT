using System.Text.Json;
using System.Text.Json.Nodes;
using Hub.Agent.Core.Configuration;
using Hub.Agent.Core.Diagnostics;
using Hub.Agent.Core.FsEgress;
using Hub.Agent.Core.Inventory.Collectors;
using Hub.Agent.Core.Spool;
using Hub.Agent.Core.Support;

namespace Hub.Agent.Core.Inventory;

/// <summary>Builds the inventory payload. Field names match the Python agent and the server model.</summary>
public static class InventoryCollector
{
    public static JsonObject Build(
        AgentConfig config,
        AgentPaths paths,
        AgentLog log,
        InventorySpool spool,
        FsEgressService? fsEgress,
        bool scanAlive,
        bool includeFullSnapshot,
        string reportType)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var sample = HealthCollector.Take();
        var userLogin = HostCollector.ActiveConsoleUser();
        var health = HealthCollector.Health(sample);

        Dictionary<string, object?>? network = includeFullSnapshot ? NetworkCollector.Collect() : null;
        var ipList = network is not null && network.GetValueOrDefault("active_ipv4") is List<string> active
            ? Text.Dedupe(active)
            : HostCollector.ActiveIpv4();

        var payload = new Dictionary<string, object?>
        {
            ["hostname"] = HostCollector.Hostname(),
            ["mac_address"] = HostCollector.MacAddress(),
            ["current_user"] = userLogin,
            ["user_login"] = userLogin,
            ["user_full_name"] = HostCollector.UserFullName(userLogin),
            ["ip_primary"] = ipList.FirstOrDefault() ?? string.Empty,
            ["ip_list"] = ipList,
            ["timestamp"] = now,
            ["report_type"] = reportType,
            ["last_seen_at"] = now,
            ["health"] = health,
            ["outlook"] = OutlookCollector.Collect(
                userLogin,
                config,
                paths,
                log,
                forceRefresh: includeFullSnapshot,
                persistState: config.PersistState),
            ["user_profile_sizes"] = ProfileSizesCollector.Collect(
                paths,
                log,
                allowScan: includeFullSnapshot && !config.SkipProfileSizes,
                persistState: config.PersistState),
            ["uptime_seconds"] = sample.UptimeSeconds,
            ["cpu_load_percent"] = sample.CpuLoadPercent,
            ["ram_used_percent"] = sample.RamUsedPercent,
            ["last_reboot_at"] = sample.BootTime,
            ["agent_runtime"] = RuntimeBlock(spool, fsEgress, scanAlive, paths),
        };

        List<Dictionary<string, object?>>? logicalDisks = null;
        if (includeFullSnapshot)
        {
            logicalDisks = DiskCollector.LogicalDisks();
            payload["system_serial"] = SystemCollector.SystemSerial();
            payload["cpu_model"] = SystemCollector.CpuModel();
            payload["ram_gb"] = sample.TotalRamGb;
            payload["monitors"] = MonitorCollector.Collect();
            payload["logical_disks"] = logicalDisks;
            payload["storage"] = DiskCollector.PhysicalDisks();
            payload["os_info"] = SystemCollector.OsInfo();
            payload["network"] = network;
            payload["security"] = SecurityCollector.Collect(config);
            payload["updates"] = SystemCollector.Updates();
            payload["last_full_snapshot_at"] = now;

            if (config.ForceSoftwareInventory || SoftwareInventoryDue(config, paths, now))
            {
                try
                {
                    var software = SoftwareCollector.Collect(config.SoftwareStoreAppsEnabled);
                    payload["software_inventory"] = software;
                    if (config.PersistState)
                    {
                        WriteSoftwareState(paths, software, log);
                    }
                }
                catch (Exception ex)
                {
                    log.Warn($"Software inventory collection failed: {ex.Message}");
                }
            }

            if (config.UsbInventoryEnabled)
            {
                try
                {
                    payload["usb_devices"] = UsbCollector.Collect();
                }
                catch (Exception ex)
                {
                    log.Warn($"USB device inventory collection failed: {ex.Message}");
                }
            }
        }

        payload["ops_health"] = HealthCollector.OpsHealth(logicalDisks, paths);

        log.Info(
            $"Inventory collected for host={payload.GetValueOrDefault("hostname")} " +
            $"user={payload.GetValueOrDefault("current_user")} type={reportType}");

        return JsonSerializer.SerializeToNode(payload) as JsonObject ?? new JsonObject();
    }

    private static Dictionary<string, object?> RuntimeBlock(
        InventorySpool spool,
        FsEgressService? fsEgress,
        bool scanAlive,
        AgentPaths paths)
        => new()
        {
            ["agent_version"] = AgentVersion.Value,
            ["inventory_queue_depth"] = spool.PendingDepth(),
            ["inventory_dead_letter_depth"] = spool.DeadDepth(),
            ["scan_outbox_depth"] = CountJsonFiles(paths.ScanOutboxPendingDir),
            ["scan_dead_letter_depth"] = CountJsonFiles(paths.ScanOutboxDeadDir),
            ["last_scan_ingest_ok_at"] = ReadScanLastIngest(paths.ScanAgentStatusFile),
            ["sidecars"] = new Dictionary<string, object?>
            {
                ["fs_egress"] = fsEgress?.Health() ?? new Dictionary<string, object?>
                {
                    ["enabled"] = false,
                    ["alive"] = false,
                },
                ["scan"] = new Dictionary<string, object?> { ["alive"] = scanAlive },
                ["telegram_probe"] = new Dictionary<string, object?>
                {
                    ["enabled"] = Text.Truthy(Environment.GetEnvironmentVariable("ITINV_TELEGRAM_PROBE_ENABLED"), false),
                    ["running"] = false,
                },
            },
        };

    private static bool SoftwareInventoryDue(AgentConfig config, AgentPaths paths, long now)
    {
        if (config.SoftwareInventoryIntervalHours <= 0)
        {
            return false;
        }

        if (!File.Exists(paths.SoftwareInventoryStateFile))
        {
            return true;
        }

        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(paths.SoftwareInventoryStateFile));
            var root = document.RootElement;
            if (!root.TryGetProperty("filter_version", out var filterVersion) ||
                !filterVersion.TryGetInt32(out var version) ||
                version != SoftwareCollector.FilterVersion)
            {
                return true;
            }

            var lastAt = root.TryGetProperty("collected_at", out var collectedAt) && collectedAt.TryGetInt64(out var parsed)
                ? parsed
                : 0;
            return now - lastAt >= config.SoftwareInventoryIntervalHours * 3600L;
        }
        catch (Exception)
        {
            return true;
        }
    }

    private static void WriteSoftwareState(AgentPaths paths, Dictionary<string, object?> software, AgentLog log)
    {
        try
        {
            var state = new Dictionary<string, object?>
            {
                ["collected_at"] = software.GetValueOrDefault("collected_at"),
                ["snapshot_hash"] = software.GetValueOrDefault("snapshot_hash"),
                ["count"] = software.GetValueOrDefault("count"),
                ["filter_version"] = SoftwareCollector.FilterVersion,
            };
            AtomicFile.WriteAllText(paths.SoftwareInventoryStateFile, JsonSerializer.Serialize(state));
        }
        catch (Exception ex)
        {
            log.Warn($"Software inventory state write failed: {ex.Message}");
        }
    }

    private static int CountJsonFiles(string directory)
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

    private static long? ReadScanLastIngest(string path)
    {
        try
        {
            if (!File.Exists(path))
            {
                return null;
            }

            using var document = JsonDocument.Parse(File.ReadAllText(path));
            if (document.RootElement.TryGetProperty("last_ingest_ok_at", out var value) && value.TryGetInt64(out var parsed) && parsed > 0)
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
}
