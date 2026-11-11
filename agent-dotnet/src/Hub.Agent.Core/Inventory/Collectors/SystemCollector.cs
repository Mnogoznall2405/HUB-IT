using System.Globalization;
using Hub.Agent.Core.Support;

namespace Hub.Agent.Core.Inventory.Collectors;

/// <summary>Operating system, CPU, BIOS serial and hotfix data.</summary>
public static class SystemCollector
{
    public static string SystemSerial()
    {
        var rows = Wmi.Query(Wmi.CimV2, "SELECT SerialNumber FROM Win32_BIOS");
        if (rows.Count == 0)
        {
            return "Unknown";
        }

        var serial = Text.Sanitize(Wmi.Str(rows[0], "SerialNumber"));
        return serial.Length == 0 ? "Unknown" : serial;
    }

    public static string CpuModel()
    {
        var rows = Wmi.Query(Wmi.CimV2, "SELECT Name FROM Win32_Processor");
        if (rows.Count == 0)
        {
            return "Unknown";
        }

        var name = Text.Sanitize(Wmi.Str(rows[0], "Name"));
        return name.Length == 0 ? "Unknown" : name;
    }

    public static Dictionary<string, object?> OsInfo()
    {
        var version = Environment.OSVersion.Version;
        var info = new Dictionary<string, object?>
        {
            ["platform"] = "Windows",
            ["release"] = ReleaseName(version),
            ["version"] = $"{version.Major}.{version.Minor}.{version.Build}",
            ["caption"] = string.Empty,
            ["build_number"] = string.Empty,
            ["install_date"] = string.Empty,
        };

        var rows = Wmi.Query(Wmi.CimV2, "SELECT Caption,Version,BuildNumber,InstallDate FROM Win32_OperatingSystem");
        if (rows.Count == 0)
        {
            return info;
        }

        var row = rows[0];
        info["caption"] = Wmi.Str(row, "Caption");
        var wmiVersion = Wmi.Str(row, "Version");
        if (wmiVersion.Length > 0)
        {
            info["version"] = wmiVersion;
        }

        info["build_number"] = Wmi.Str(row, "BuildNumber");
        if (Wmi.Date(row, "InstallDate") is { } installed)
        {
            info["install_date"] = installed.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture);
        }

        return info;
    }

    public static Dictionary<string, object?> Updates()
    {
        var rows = Wmi.Query(Wmi.CimV2, "SELECT HotFixID,InstalledOn FROM Win32_QuickFixEngineering");
        DateTime? latest = null;
        string latestText = string.Empty;

        foreach (var row in rows)
        {
            var raw = Wmi.Str(row, "InstalledOn");
            if (raw.Length == 0)
            {
                continue;
            }

            if (DateTime.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
            {
                if (latest is null || parsed > latest)
                {
                    latest = parsed;
                    latestText = parsed.ToString("M/d/yyyy", CultureInfo.InvariantCulture);
                }
            }
            else
            {
                latestText = raw;
            }
        }

        return new Dictionary<string, object?> { ["last_hotfix_date"] = latestText };
    }

    private static string ReleaseName(Version version)
    {
        if (version.Build >= 22000)
        {
            return "11";
        }

        if (version.Build >= 10240)
        {
            return "10";
        }

        return version.Major > 0 ? version.Major.ToString(CultureInfo.InvariantCulture) : string.Empty;
    }
}
