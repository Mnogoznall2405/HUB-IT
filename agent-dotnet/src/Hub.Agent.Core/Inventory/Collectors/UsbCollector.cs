using System.Globalization;
using System.Text.Json;
using Microsoft.Win32;
using Hub.Agent.Core.Support;

namespace Hub.Agent.Core.Inventory.Collectors;

/// <summary>
/// USB storage history (registry USBSTOR) plus devices that are plugged in now
/// (Win32_DiskDrive InterfaceType='USB', WPD/Image PnP entities).
/// </summary>
public static class UsbCollector
{
    private const string UsbStorPath = @"SYSTEM\CurrentControlSet\Enum\USBSTOR";
    private const string TimestampProperties = @"Properties\{83da6326-97a6-4088-9453-a1923f573b29}";
    private const int Limit = 500;

    public static Dictionary<string, object?> Collect()
    {
        var history = ReadHistory();
        var present = PresentDisks();

        foreach (var row in history)
        {
            var pnp = Text.Sanitize(row.GetValueOrDefault("pnp_device_id")).ToLowerInvariant();
            if (!present.TryGetValue(pnp, out var match))
            {
                continue;
            }

            row["present"] = true;
            var size = Text.ToLongOrNull(match.GetValueOrDefault("size"));
            row["size_gb"] = size is > 0 ? Text.Round(size.Value / (1024.0 * 1024 * 1024), 1) : null;
        }

        var items = new List<Dictionary<string, object?>>(history);
        items.AddRange(PortableDevices());
        items = items.Take(Math.Max(1, Limit)).ToList();

        items.Sort((left, right) =>
        {
            var leftPresent = left.GetValueOrDefault("present") is true ? 0 : 1;
            var rightPresent = right.GetValueOrDefault("present") is true ? 0 : 1;
            if (leftPresent != rightPresent)
            {
                return leftPresent.CompareTo(rightPresent);
            }

            var leftLast = Text.ToLong(left.GetValueOrDefault("last_connected_at"), 0);
            var rightLast = Text.ToLong(right.GetValueOrDefault("last_connected_at"), 0);
            if (leftLast != rightLast)
            {
                return rightLast.CompareTo(leftLast);
            }

            return string.Compare(
                Text.Sanitize(left.GetValueOrDefault("product")),
                Text.Sanitize(right.GetValueOrDefault("product")),
                StringComparison.OrdinalIgnoreCase);
        });

        return new Dictionary<string, object?>
        {
            ["items"] = items,
            ["count"] = items.Count,
            ["snapshot_hash"] = HashItems(items),
            ["collected_at"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
        };
    }

    private static List<Dictionary<string, object?>> ReadHistory()
    {
        var items = new List<Dictionary<string, object?>>();
        try
        {
            using var usbstor = Registry.LocalMachine.OpenSubKey(UsbStorPath);
            if (usbstor is null)
            {
                return items;
            }

            foreach (var classKey in usbstor.GetSubKeyNames())
            {
                var classPath = $@"{UsbStorPath}\{classKey}";
                using var classHandle = Registry.LocalMachine.OpenSubKey(classPath);
                if (classHandle is null)
                {
                    continue;
                }

                foreach (var instanceKey in classHandle.GetSubKeyNames())
                {
                    var instancePath = $@"{classPath}\{instanceKey}";
                    var friendlyName = string.Empty;
                    try
                    {
                        using var instance = Registry.LocalMachine.OpenSubKey(instancePath);
                        friendlyName = Text.Sanitize(instance?.GetValue("FriendlyName"));
                    }
                    catch (Exception)
                    {
                        // best effort
                    }

                    var stamps = $@"{instancePath}\{TimestampProperties}";
                    var first = ReadFileTime($@"{stamps}\0065");
                    if (first == 0)
                    {
                        first = ReadFileTime($@"{stamps}\0064");
                    }

                    var row = ParseUsbStorIds(classKey, instanceKey);
                    row["kind"] = "storage";
                    row["friendly_name"] = friendlyName;
                    row["first_connected_at"] = first > 0 ? first : null;
                    var lastConnected = ReadFileTime($@"{stamps}\0066");
                    row["last_connected_at"] = lastConnected > 0 ? lastConnected : null;
                    var lastRemoved = ReadFileTime($@"{stamps}\0067");
                    row["last_removed_at"] = lastRemoved > 0 ? lastRemoved : null;
                    row["present"] = false;
                    row["size_gb"] = null;
                    row["pnp_device_id"] = $@"USBSTOR\{classKey}\{instanceKey}";
                    items.Add(row);
                }
            }
        }
        catch (Exception)
        {
            // registry unavailable
        }

        return items;
    }

    private static Dictionary<string, object?> ParseUsbStorIds(string classKey, string instanceKey)
    {
        var vendor = string.Empty;
        var product = string.Empty;
        var revision = string.Empty;
        var deviceType = string.Empty;

        foreach (var part in Text.Sanitize(classKey).Split('&'))
        {
            var lowered = part.ToLowerInvariant();
            if (lowered.StartsWith("ven_", StringComparison.Ordinal))
            {
                vendor = part[4..].Replace('_', ' ').Trim();
            }
            else if (lowered.StartsWith("prod_", StringComparison.Ordinal))
            {
                product = part[5..].Replace('_', ' ').Trim();
            }
            else if (lowered.StartsWith("rev_", StringComparison.Ordinal))
            {
                revision = part[4..].Trim();
            }
            else if (deviceType.Length == 0)
            {
                deviceType = part.Trim();
            }
        }

        var instance = Text.Sanitize(instanceKey);
        var serial = instance.Contains('&') ? instance[..instance.LastIndexOf('&')] : instance;
        var hasUniqueSerial = serial.Length > 0 && !char.IsDigit(serial[0]);

        return new Dictionary<string, object?>
        {
            ["device_type"] = deviceType,
            ["vendor"] = vendor,
            ["product"] = product,
            ["revision"] = revision,
            ["serial"] = serial,
            ["has_unique_serial"] = hasUniqueSerial,
        };
    }

    private static long ReadFileTime(string path)
    {
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(path);
            var raw = key?.GetValue(string.Empty);
            switch (raw)
            {
                case byte[] bytes when bytes.Length >= 8:
                    return FileTimeToEpoch(BitConverter.ToInt64(bytes, 0));
                case long value:
                    return FileTimeToEpoch(value);
                case int value:
                    return FileTimeToEpoch(value);
            }
        }
        catch (Exception)
        {
            // property missing
        }

        return 0;
    }

    private static long FileTimeToEpoch(long fileTime)
    {
        if (fileTime <= 0)
        {
            return 0;
        }

        try
        {
            return (long)(DateTime.FromFileTimeUtc(fileTime) - DateTime.UnixEpoch).TotalSeconds;
        }
        catch (ArgumentOutOfRangeException)
        {
            return 0;
        }
    }

    private static Dictionary<string, Dictionary<string, object?>> PresentDisks()
    {
        var result = new Dictionary<string, Dictionary<string, object?>>(StringComparer.OrdinalIgnoreCase);
        var rows = Wmi.Query(
            Wmi.CimV2,
            "SELECT PNPDeviceID,Model,Size FROM Win32_DiskDrive WHERE InterfaceType='USB'");
        foreach (var row in rows)
        {
            var pnp = Wmi.Str(row, "PNPDeviceID");
            if (pnp.Length == 0)
            {
                continue;
            }

            result[pnp] = new Dictionary<string, object?>
            {
                ["pnp"] = pnp,
                ["model"] = Wmi.Str(row, "Model"),
                ["size"] = Wmi.Long(row, "Size"),
            };
        }

        return result;
    }

    private static List<Dictionary<string, object?>> PortableDevices()
    {
        var result = new List<Dictionary<string, object?>>();
        var rows = Wmi.Query(
            Wmi.CimV2,
            "SELECT PNPDeviceID,Name,Manufacturer,PNPClass FROM Win32_PnPEntity WHERE PNPClass='WPD' OR PNPClass='Image'");
        foreach (var row in rows)
        {
            var pnp = Wmi.Str(row, "PNPDeviceID");
            if (pnp.Length == 0
                || (!pnp.StartsWith("USB\\", StringComparison.OrdinalIgnoreCase)
                    && !pnp.StartsWith("SWD\\WPDBUSENUM", StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }

            var name = Wmi.Str(row, "Name");
            result.Add(new Dictionary<string, object?>
            {
                ["kind"] = "portable",
                ["device_type"] = Wmi.Str(row, "PNPClass"),
                ["vendor"] = Wmi.Str(row, "Manufacturer"),
                ["product"] = name,
                ["friendly_name"] = name,
                ["revision"] = string.Empty,
                ["serial"] = pnp[(pnp.LastIndexOf('\\') + 1)..],
                ["has_unique_serial"] = false,
                ["first_connected_at"] = null,
                ["last_connected_at"] = null,
                ["last_removed_at"] = null,
                ["present"] = true,
                ["size_gb"] = null,
                ["pnp_device_id"] = pnp,
            });
        }

        return result;
    }

    private static string HashItems(List<Dictionary<string, object?>> items)
    {
        var builder = new System.Text.StringBuilder("[");
        for (var index = 0; index < items.Count; index++)
        {
            if (index > 0)
            {
                builder.Append(',');
            }

            builder.Append('{');
            var first = true;
            foreach (var pair in items[index].OrderBy(pair => pair.Key, StringComparer.Ordinal))
            {
                if (!first)
                {
                    builder.Append(',');
                }

                first = false;
                builder.Append(JsonSerializer.Serialize(pair.Key));
                builder.Append(':');
                builder.Append(JsonSerializer.Serialize(Convert.ToString(pair.Value, CultureInfo.InvariantCulture)));
            }

            builder.Append('}');
        }

        builder.Append(']');
        return Text.Sha256Hex(builder.ToString());
    }
}
