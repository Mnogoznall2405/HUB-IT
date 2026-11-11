using System.Text.Json;
using Microsoft.Win32;
using Hub.Agent.Core.Support;

namespace Hub.Agent.Core.Inventory.Collectors;

/// <summary>Runtime health, pending-reboot state and disk pressure for ops dashboards.</summary>
public static class HealthCollector
{
    private const double LowDiskFreeGb = 5.0;
    public const string AgentTaskName = "HUB-IT Agent";

    public sealed record Sample(long UptimeSeconds, double CpuLoadPercent, double RamUsedPercent, ulong TotalRamBytes, long BootTime)
    {
        public double TotalRamGb => Text.Round(TotalRamBytes / (1024.0 * 1024 * 1024), 2);
    }

    public static Sample Take(int sampleMs = 200)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var uptime = (long)Native.UptimeSeconds;
        var (cpu, totalRam, memoryLoad) = Native.SampleSystem(sampleMs);
        var bootTime = now - uptime;
        return new Sample(uptime, cpu, memoryLoad, totalRam, bootTime);
    }

    public static Dictionary<string, object?> Health(Sample sample)
    {
        var bootIso = DateTimeOffset.FromUnixTimeSeconds(sample.BootTime).ToLocalTime().ToString("yyyy-MM-ddTHH:mm:ss");
        return new Dictionary<string, object?>
        {
            ["uptime_seconds"] = sample.UptimeSeconds,
            ["cpu_load_percent"] = sample.CpuLoadPercent,
            ["ram_used_percent"] = sample.RamUsedPercent,
            ["boot_time"] = sample.BootTime,
            ["last_reboot_at"] = sample.BootTime,
            ["last_reboot_iso"] = bootIso,
        };
    }

    public static Dictionary<string, object?> OpsHealth(
        List<Dictionary<string, object?>>? logicalDisks,
        AgentPaths paths,
        string? reminderStateFile = null)
    {
        var systemDrive = (Environment.GetEnvironmentVariable("SystemDrive") ?? "C:").Trim().ToUpperInvariant();
        if (systemDrive.Length == 0)
        {
            systemDrive = "C:";
        }

        var systemRoot = systemDrive.EndsWith('\\') ? systemDrive : systemDrive + "\\";
        double? freeGb = null;
        double? usedPercent = null;
        var lowVolumes = new List<string>();

        foreach (var disk in logicalDisks ?? new List<Dictionary<string, object?>>())
        {
            var mount = Text.Sanitize(disk.GetValueOrDefault("mountpoint")).ToUpperInvariant();
            var diskFree = disk.GetValueOrDefault("free_gb") is { } free ? Convert.ToDouble(free) : (double?)null;
            if (diskFree is not null && diskFree.Value < LowDiskFreeGb)
            {
                lowVolumes.Add(mount.Length > 0
                    ? mount
                    : Text.Sanitize(disk.GetValueOrDefault("device")) is { Length: > 0 } device ? device : "?");
            }

            if (string.Equals(mount.TrimEnd('\\'), systemDrive.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase) ||
                string.Equals(mount, systemRoot, StringComparison.OrdinalIgnoreCase))
            {
                freeGb = diskFree;
                usedPercent = disk.GetValueOrDefault("percent") is { } percent ? Convert.ToDouble(percent) : null;
            }
        }

        if (freeGb is null)
        {
            try
            {
                var info = new DriveInfo(systemRoot);
                if (info.IsReady && info.TotalSize > 0)
                {
                    freeGb = Text.Round(info.AvailableFreeSpace / (1024.0 * 1024 * 1024), 2);
                    usedPercent = Text.Round((info.TotalSize - info.AvailableFreeSpace) / (double)info.TotalSize * 100.0, 1);
                    if (freeGb.Value < LowDiskFreeGb && !lowVolumes.Contains(systemDrive))
                    {
                        lowVolumes.Add(systemDrive);
                    }
                }
            }
            catch (Exception)
            {
                // no system drive info
            }
        }

        var (pendingReboot, reasons) = PendingReboot();

        return new Dictionary<string, object?>
        {
            ["system_drive_free_gb"] = freeGb,
            ["system_drive_percent"] = usedPercent,
            ["low_disk"] = (freeGb is not null && freeGb.Value < LowDiskFreeGb) || lowVolumes.Count > 0,
            ["low_disk_volumes"] = lowVolumes,
            ["pending_reboot"] = pendingReboot,
            ["pending_reboot_reasons"] = reasons,
            ["last_reboot_reminder_at"] = ReadLastReminder(reminderStateFile ?? paths.RebootReminderStateFile),
            ["agent_task_name"] = AgentTaskName,
            ["program_data_root"] = paths.AgentRoot,
            ["legacy_itinvent_present"] = Directory.Exists(paths.LegacyRoot),
        };
    }

    public static (bool Pending, List<string> Reasons) PendingReboot()
    {
        var reasons = new List<string>();
        if (KeyExists(RegistryHive.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending"))
        {
            reasons.Add("cbs_reboot_pending");
        }

        if (KeyExists(RegistryHive.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired"))
        {
            reasons.Add("windows_update_reboot_required");
        }

        try
        {
            using var baseKey = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
            using var key = baseKey.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Session Manager");
            if (key?.GetValue("PendingFileRenameOperations") is not null)
            {
                reasons.Add("pending_file_rename");
            }
        }
        catch (Exception)
        {
            // no pending renames
        }

        return (reasons.Count > 0, reasons);
    }

    private static bool KeyExists(RegistryHive hive, string path)
    {
        try
        {
            using var baseKey = RegistryKey.OpenBaseKey(hive, RegistryView.Registry64);
            using var key = baseKey.OpenSubKey(path);
            return key is not null;
        }
        catch (Exception)
        {
            return false;
        }
    }

    private static long? ReadLastReminder(string path)
    {
        try
        {
            if (!File.Exists(path))
            {
                return null;
            }

            using var document = JsonDocument.Parse(File.ReadAllText(path));
            var root = document.RootElement;
            foreach (var key in new[] { "last_sent_at", "last_reminder_at" })
            {
                if (root.TryGetProperty(key, out var value) && value.TryGetInt64(out var parsed))
                {
                    return parsed;
                }
            }
        }
        catch (Exception)
        {
            // state file corrupt or missing
        }

        return null;
    }
}
