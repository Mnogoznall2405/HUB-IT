using System.Text;
using Microsoft.Win32;
using Hub.Agent.Core.Support;

namespace Hub.Agent.Core.Inventory.Collectors;

/// <summary>Monitors with serial numbers: EDID from the registry, WmiMonitorID as fallback.</summary>
public static class MonitorCollector
{
    private static readonly HashSet<string> InvalidSerials = new(StringComparer.Ordinal)
    {
        "0",
        "00000000",
        "FFFFFFFF",
        "ffffffffff",
    };

    public static List<Dictionary<string, object?>> Collect()
    {
        var monitors = new List<Dictionary<string, object?>>();
        var rows = Wmi.Query(Wmi.WmiNamespace, "SELECT InstanceName,ManufacturerName,ProductCodeID,SerialNumberID FROM WmiMonitorID");
        foreach (var row in rows)
        {
            try
            {
                var instanceName = Wmi.Str(row, "InstanceName");
                var manufacturer = Wmi.DecodeCharArray(AsUshortArray(row, "ManufacturerName"));
                var productCode = Wmi.DecodeCharArray(AsUshortArray(row, "ProductCodeID"));

                var serial = string.Empty;
                var source = "unknown";
                var edid = ReadEdidForInstance(instanceName);
                if (edid.Length > 0)
                {
                    var serialFromEdid = ParseEdidSerial(edid);
                    if (serialFromEdid.Length > 0)
                    {
                        serial = serialFromEdid;
                        source = "edid";
                    }
                }

                if (serial.Length == 0)
                {
                    var wmiSerial = ValidateSerial(Wmi.DecodeCharArray(AsUshortArray(row, "SerialNumberID")));
                    if (wmiSerial.Length > 0)
                    {
                        serial = wmiSerial;
                        source = "wmi_fallback";
                    }
                }

                monitors.Add(new Dictionary<string, object?>
                {
                    ["manufacturer"] = manufacturer,
                    ["product_code"] = productCode,
                    ["serial_number"] = serial,
                    ["serial_source"] = source,
                });
            }
            catch (Exception)
            {
                // one bad monitor must not drop the rest
            }
        }

        return monitors;
    }

    public static byte[] ReadEdidForInstance(string instanceName)
    {
        var cleaned = Text.Sanitize(instanceName).Replace('/', '\\');
        if (cleaned.Length == 0)
        {
            return Array.Empty<byte>();
        }

        var parts = cleaned.Split('\\');
        var candidates = new List<string>();
        if (parts.Length >= 3)
        {
            var pnpId = parts[2];
            candidates.Add($"{parts[0]}\\{parts[1]}\\{pnpId}");
            var underscore = pnpId.IndexOf('_');
            if (underscore > 0)
            {
                candidates.Add($"{parts[0]}\\{parts[1]}\\{pnpId[..underscore]}");
            }
        }

        foreach (var candidate in candidates)
        {
            var path = $"SYSTEM\\CurrentControlSet\\Enum\\{candidate}\\Device Parameters";
            try
            {
                using var key = Registry.LocalMachine.OpenSubKey(path);
                if (key?.GetValue("EDID") is byte[] { Length: > 0 } edid)
                {
                    return edid;
                }
            }
            catch (Exception)
            {
                // try next candidate
            }
        }

        return Array.Empty<byte>();
    }

    public static string ParseEdidSerial(byte[] edid)
    {
        if (edid.Length < 128)
        {
            return string.Empty;
        }

        for (var offset = 54; offset + 18 <= 126; offset += 18)
        {
            if (edid[offset] != 0x00 || edid[offset + 1] != 0x00 || edid[offset + 2] != 0x00 || edid[offset + 3] != 0xFF)
            {
                continue;
            }

            var raw = Encoding.ASCII.GetString(edid, offset + 5, 13).Replace("\n", string.Empty).Trim();
            var serial = ValidateSerial(raw);
            if (serial.Length > 0)
            {
                return serial;
            }
        }

        return string.Empty;
    }

    public static string ValidateSerial(string? value)
    {
        var serial = Text.Sanitize(value).Replace("\n", string.Empty).Replace("\r", string.Empty);
        var builder = new StringBuilder(serial.Length);
        foreach (var symbol in serial)
        {
            if (char.IsAsciiLetterOrDigit(symbol) || symbol is '.' or '_' or '-')
            {
                builder.Append(symbol);
            }
        }

        var cleaned = builder.ToString();
        return InvalidSerials.Contains(cleaned) ? string.Empty : cleaned;
    }

    private static ushort[]? AsUshortArray(IReadOnlyDictionary<string, object?> row, string key)
        => row.TryGetValue(key, out var value) && value is ushort[] codes ? codes : null;
}
