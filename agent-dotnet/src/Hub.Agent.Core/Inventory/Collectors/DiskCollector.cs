using Hub.Agent.Core.Support;

namespace Hub.Agent.Core.Inventory.Collectors;

/// <summary>Logical volumes and physical disks (MSFT_PhysicalDisk + Win32_DiskDrive).</summary>
public static class DiskCollector
{
    private static readonly HashSet<string> GenericNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "disk",
        "disk drive",
        "fixed hard disk media",
        "physical disk",
        "physicaldisk",
        "scsi disk device",
        "unknown",
    };

    private static readonly string[] GenericSuffixes = { "scsi disk device", "ata device" };

    private static readonly string[] VirtualBusMarkers = { "virtual", "file backed", "storage spaces", "spaces", "ram" };

    private static string[] VirtualModelMarkers => new[] { "virtual", "vmware", "vbox", "virtualbox", "hyper-v", "qemu", "msft virtual" };

    private static readonly string[] ContainerMarkers =
    {
        "\\windows\\containers\\",
        "\\programdata\\docker\\",
        "\\docker\\windowsfilter\\",
        "\\containerstorage\\",
    };

    private static readonly Dictionary<string, string> BusLabels = new(StringComparer.OrdinalIgnoreCase)
    {
        ["nvme"] = "NVMe",
        ["sata"] = "SATA",
        ["sas"] = "SAS",
        ["scsi"] = "SCSI",
        ["raid"] = "RAID",
        ["usb"] = "USB",
        ["sd"] = "SD",
    };

    /// <summary>BusType values from MSFT_PhysicalDisk.</summary>
    private static readonly Dictionary<long, string> BusTypeNames = new()
    {
        [1] = "SCSI",
        [2] = "ATAPI",
        [3] = "ATA",
        [4] = "1394",
        [5] = "SSA",
        [6] = "Fibre Channel",
        [7] = "USB",
        [8] = "RAID",
        [9] = "iSCSI",
        [10] = "SAS",
        [11] = "SATA",
        [12] = "SD",
        [13] = "MMC",
        [14] = "Virtual",
        [15] = "File Backed Virtual",
        [16] = "Storage Spaces",
        [17] = "NVMe",
        [18] = "SCM",
        [19] = "UFS",
    };

    private static readonly Dictionary<long, string> MediaTypeNames = new()
    {
        [3] = "HDD",
        [4] = "SSD",
        [5] = "SCM",
        [0] = "Unspecified",
    };

    private static readonly Dictionary<long, string> HealthNames = new()
    {
        [0] = "Healthy",
        [1] = "Warning",
        [2] = "Unhealthy",
        [5] = "Unknown",
    };

    public static List<Dictionary<string, object?>> LogicalDisks()
    {
        var byDevice = new Dictionary<string, Dictionary<string, object?>>(StringComparer.OrdinalIgnoreCase);

        foreach (var drive in DriveInfo.GetDrives())
        {
            try
            {
                if (drive.DriveType is DriveType.CDRom or DriveType.NoRootDirectory or DriveType.Network)
                {
                    continue;
                }

                if (!drive.IsReady)
                {
                    continue;
                }

                var total = drive.TotalSize;
                if (total <= 0)
                {
                    continue;
                }

                var available = drive.AvailableFreeSpace;
                var used = total - available;
                var totalGb = Text.Round(total / (1024.0 * 1024 * 1024), 2);
                if (totalGb <= 0)
                {
                    continue;
                }

                var device = drive.Name.TrimEnd('\\');
                var disk = new Dictionary<string, object?>
                {
                    ["device"] = device,
                    ["mountpoint"] = drive.Name,
                    ["fstype"] = Text.Sanitize(drive.DriveFormat),
                    ["total_gb"] = totalGb,
                    ["used_gb"] = Text.Round(used / (1024.0 * 1024 * 1024), 2),
                    ["free_gb"] = Text.Round(available / (1024.0 * 1024 * 1024), 2),
                    ["percent"] = Text.Round(used / (double)total * 100.0, 1),
                };

                var key = device.ToLowerInvariant();
                if (key.Length == 0 || !byDevice.TryGetValue(key, out var existing))
                {
                    byDevice[key] = disk;
                }
                else if (disk["mountpoint"] is string mountpoint
                         && existing["mountpoint"] is string existingMountpoint
                         && mountpoint.Length < existingMountpoint.Length)
                {
                    // Prefer the drive root ("C:\") over a mounted folder for the same device.
                    byDevice[key] = disk;
                }
            }
            catch (Exception)
            {
                // one unreadable volume must not drop the rest
            }
        }

        return byDevice.Values
            .OrderBy(item => Text.Sanitize(item.GetValueOrDefault("mountpoint")), StringComparer.Ordinal)
            .ToList();
    }

    public static List<Dictionary<string, object?>> PhysicalDisks()
    {
        var diskdriveRows = Wmi.Query(
            Wmi.CimV2,
            "SELECT Caption,Model,SerialNumber,PNPDeviceID,Size,Index FROM Win32_DiskDrive");

        var rows = Wmi.Query(
            Wmi.Storage,
            "SELECT FriendlyName,SerialNumber,MediaType,BusType,Size,HealthStatus,Usage,DeviceId FROM MSFT_PhysicalDisk");

        var reliability = Wmi.Query(
            Wmi.Storage,
            "SELECT DeviceId,Wear,Temperature,PowerOnHours,StartStopCycleCount FROM MSFT_StorageReliabilityCounter");
        var reliabilityIndex = new Dictionary<string, Dictionary<string, object?>>(StringComparer.OrdinalIgnoreCase);
        foreach (var counter in reliability)
        {
            var counterKey = ReliabilityKey(Wmi.Str(counter, "DeviceId"));
            if (counterKey.Length > 0)
            {
                reliabilityIndex[counterKey] = counter;
            }
        }

        var used = new HashSet<int>();
        var disks = new List<Dictionary<string, object?>>();

        foreach (var row in rows)
        {
            var model = Text.CompactSpaces(Wmi.Str(row, "FriendlyName"));
            var serial = Text.CompactSpaces(Wmi.Str(row, "SerialNumber"));
            var busTypeValue = Wmi.Long(row, "BusType") ?? 0;
            var busType = BusTypeNames.TryGetValue(busTypeValue, out var name) ? name : busTypeValue == 0 ? "Unknown" : busTypeValue.ToString();
            var size = Wmi.Long(row, "Size");
            var mediaTypeValue = Wmi.Long(row, "MediaType") ?? 0;
            var mediaType = MediaTypeNames.TryGetValue(mediaTypeValue, out var media) ? media : null;
            var healthValue = Wmi.Long(row, "HealthStatus");
            var health = healthValue is { } hv && HealthNames.TryGetValue(hv, out var healthName) ? healthName : "Unknown";

            var matched = MatchDiskDrive(
                serial,
                model,
                size,
                diskdriveRows,
                used);

            var caption = Text.CompactSpaces(matched is null ? string.Empty : Wmi.Str(matched, "Caption"));
            var pnpId = matched is null ? string.Empty : Wmi.Str(matched, "PNPDeviceID");
            if (model.Length == 0 && matched is not null)
            {
                model = Text.CompactSpaces(Wmi.Str(matched, "Model"));
            }

            if (serial.Length == 0 && matched is not null)
            {
                serial = Text.CompactSpaces(Wmi.Str(matched, "SerialNumber"));
            }

            if (size is null && matched is not null)
            {
                size = Wmi.Long(matched, "Size");
            }

            var displayName = BuildDisplayName(model, caption, model, busType, size);
            var item = new Dictionary<string, object?>
            {
                ["model"] = model,
                ["serial_number"] = serial,
                ["media_type"] = mediaType,
                ["bus_type"] = busType,
                ["size_bytes"] = size,
                ["display_name"] = displayName,
                ["raw_model"] = model,
                ["raw_friendly_name"] = Text.CompactSpaces(Wmi.Str(row, "FriendlyName")),
                ["raw_caption"] = caption,
                ["raw_pnp_device_id"] = pnpId,
                ["health_status"] = health,
                ["wear_out_percentage"] = null,
                ["temperature"] = null,
                ["extended_info"] = new Dictionary<string, object?>
                {
                    ["usage"] = Wmi.Str(row, "Usage"),
                    ["device_id"] = Wmi.Str(row, "DeviceId"),
                    ["media_type_raw"] = mediaTypeValue,
                    ["bus_type_raw"] = busTypeValue,
                },
            };

            var diskKey = ReliabilityKey(Wmi.Str(row, "DeviceId"));
            if (diskKey.Length == 0)
            {
                diskKey = ReliabilityKey((Wmi.Long(row, "Number") ?? 0).ToString());
            }

            reliabilityIndex.TryGetValue(diskKey, out var reliabilityRow);
            ApplyReliabilityCounter(item, reliabilityRow);

            var reasons = SkipReasons(item);
            if (reasons.Count > 0)
            {
                continue;
            }

            disks.Add(item);
        }

        return disks;
    }

    private static List<string> SkipReasons(Dictionary<string, object?> disk)
    {
        var model = Text.Sanitize(disk.GetValueOrDefault("model"))?.ToLowerInvariant() ?? string.Empty;
        var serial = Text.Sanitize(disk.GetValueOrDefault("serial_number"))?.ToLowerInvariant() ?? string.Empty;
        var busType = Text.Sanitize(disk.GetValueOrDefault("bus_type"))?.ToLowerInvariant() ?? string.Empty;

        var reasons = new List<string>();
        if (model.Length == 0 && serial.Length == 0)
        {
            reasons.Add("empty");
        }

        if (VirtualBusMarkers.Any(marker => busType.Contains(marker, StringComparison.Ordinal)))
        {
            reasons.Add("virtual_bus");
        }

        if (VirtualModelMarkers.Any(marker => model.Contains(marker, StringComparison.Ordinal)))
        {
            reasons.Add("virtual_model");
        }

        return reasons;
    }

    private static Dictionary<string, object?>? MatchDiskDrive(
        string serial,
        string model,
        long? size,
        IReadOnlyList<Dictionary<string, object?>> rows,
        HashSet<int> used)
    {
        var serialKey = Text.Sanitize(serial).ToLowerInvariant();
        if (serialKey.Length > 0)
        {
            for (var index = 0; index < rows.Count; index++)
            {
                if (used.Contains(index))
                {
                    continue;
                }

                if (Text.Sanitize(Wmi.Str(rows[index], "SerialNumber")).ToLowerInvariant() == serialKey)
                {
                    used.Add(index);
                    return rows[index];
                }
            }
        }

        var modelKey = Text.Sanitize(model).ToLowerInvariant();
        if (modelKey.Length > 0)
        {
            for (var index = 0; index < rows.Count; index++)
            {
                if (used.Contains(index))
                {
                    continue;
                }

                var rowModel = Text.Sanitize(Wmi.Str(rows[index], "Model")).ToLowerInvariant();
                if (rowModel.Length == 0)
                {
                    continue;
                }

                var matchesModel = modelKey.Contains(rowModel, StringComparison.Ordinal) || rowModel.Contains(modelKey, StringComparison.Ordinal);
                if (!matchesModel)
                {
                    continue;
                }

                var rowSize = Wmi.Long(rows[index], "Size");
                if (IsSizeClose(size, rowSize) || size is null || rowSize is null)
                {
                    used.Add(index);
                    return rows[index];
                }
            }
        }

        if (size is not null)
        {
            for (var index = 0; index < rows.Count; index++)
            {
                if (used.Contains(index))
                {
                    continue;
                }

                if (IsSizeClose(size, Wmi.Long(rows[index], "Size")))
                {
                    used.Add(index);
                    return rows[index];
                }
            }
        }

        return null;
    }

    private static bool IsSizeClose(long? left, long? right)
    {
        if (left is null or <= 0 || right is null or <= 0)
        {
            return false;
        }

        var difference = Math.Abs(left.Value - right.Value);
        var tolerance = Math.Max(10L * 1024 * 1024, (long)(Math.Max(left.Value, right.Value) * 0.01));
        return difference <= tolerance;
    }

    public static string ReliabilityKey(string? value)
    {
        var key = Text.Sanitize(value).ToUpperInvariant();
        const string devicePrefix = @"\\.\PHYSICALDRIVE";
        if (key.StartsWith(devicePrefix, StringComparison.Ordinal))
        {
            key = key[devicePrefix.Length..];
        }
        else if (key.StartsWith("PHYSICALDRIVE", StringComparison.Ordinal))
        {
            key = key["PHYSICALDRIVE".Length..];
        }

        return key.Trim();
    }

    public static void ApplyReliabilityCounter(
        Dictionary<string, object?> disk,
        IReadOnlyDictionary<string, object?>? counter)
    {
        if (counter is null)
        {
            return;
        }

        if (Wmi.Long(counter, "Wear") is { } wear)
        {
            disk["wear_out_percentage"] = wear;
        }

        if (Wmi.Long(counter, "Temperature") is { } temperature)
        {
            disk["temperature"] = temperature;
        }

        if (disk.GetValueOrDefault("extended_info") is Dictionary<string, object?> extended)
        {
            extended["power_on_hours"] = Wmi.Long(counter, "PowerOnHours");
            extended["start_stop_cycle_count"] = Wmi.Long(counter, "StartStopCycleCount");
        }
    }

    public static string BuildDisplayName(string? friendlyName, string? caption, string? model, string? busType, long? size)
    {
        var candidates = new[] { Text.CompactSpaces(friendlyName), Text.CompactSpaces(caption), Text.CompactSpaces(model) };
        var baseName = candidates.FirstOrDefault(candidate => candidate.Length > 0 && !IsGenericName(candidate))
                       ?? candidates.FirstOrDefault(candidate => candidate.Length > 0)
                       ?? "Unknown Disk";

        var parts = new List<string>();
        var busLabel = BusLabel(busType);
        if (busLabel.Length > 0 && !busLabel.Equals("UNKNOWN", StringComparison.OrdinalIgnoreCase))
        {
            parts.Add(busLabel);
        }

        var sizeLabel = FormatSizeLabel(size);
        if (sizeLabel.Length > 0)
        {
            parts.Add(sizeLabel);
        }

        return parts.Count > 0 ? $"{baseName} ({string.Join(", ", parts)})" : baseName;
    }

    private static bool IsGenericName(string value)
    {
        var normalized = Text.Sanitize(value).ToLowerInvariant();
        if (normalized.Length == 0 || GenericNames.Contains(normalized))
        {
            return true;
        }

        return GenericSuffixes.Any(suffix => normalized.EndsWith(suffix, StringComparison.Ordinal));
    }

    private static string BusLabel(string? value)
    {
        var raw = Text.Sanitize(value).ToLowerInvariant();
        if (raw.Length == 0)
        {
            return string.Empty;
        }

        return BusLabels.TryGetValue(raw, out var label) ? label : Text.Sanitize(value).ToUpperInvariant();
    }

    private static string FormatSizeLabel(long? sizeBytes)
    {
        if (sizeBytes is null or <= 0)
        {
            return string.Empty;
        }

        var gib = sizeBytes.Value / (1024.0 * 1024 * 1024);
        if (gib >= 1024)
        {
            return $"{gib / 1024.0:0.0} TB";
        }

        return $"{Math.Round(gib, MidpointRounding.ToEven)} GB";
    }
}
