using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Win32;
using Hub.Agent.Core.Support;

namespace Hub.Agent.Core.Inventory.Collectors;

/// <summary>Installed programs: machine-wide, per-user hives and Microsoft Store packages.</summary>
public static partial class SoftwareCollector
{
    private const int Limit = 2500;
    public const int FilterVersion = 1;

    private static readonly HashSet<string> SystemReleaseTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "driver", "feature pack", "hotfix", "security update", "service pack", "update", "update rollup",
        "безопасность", "драйвер", "исправление", "обновление", "обновление для системы безопасности",
    };

    private static readonly HashSet<string> SystemStorePackages = new(StringComparer.OrdinalIgnoreCase)
    {
        "microsoft.desktopappinstaller",
        "microsoft.gamingservices",
        "microsoft.gethelp",
        "microsoft.getstarted",
        "microsoft.sechealthui",
        "microsoft.storepurchaseapp",
        "microsoft.widgetsplatformruntime",
        "microsoft.windowsfeedbackhub",
        "microsoft.windowsstore",
        "microsoft.xbox.tcui",
        "microsoft.xboxgameoverlay",
        "microsoft.xboxgamingoverlay",
        "microsoft.xboxidentityprovider",
        "microsoft.xboxspeechtotextoverlay",
        "microsoftwindows.client.webexperience",
    };

    private static readonly string[] SystemStorePrefixes =
    {
        "microsoft.net.native.", "microsoft.ui.xaml.", "microsoft.vclibs.", "microsoft.windowsappruntime.",
    };

    [GeneratedRegex(
        "^(?:(?:microsoft )?visual c\\+\\+ .*redistributable\\b|(?:microsoft )?\\.net (?:runtime|host)\\b|" +
        "(?:microsoft )?asp\\.net core .*\\b(?:runtime|shared framework)\\b|" +
        "(?:microsoft )?(?:edge webview2|windows desktop|windows app) runtime\\b|" +
        "microsoft (?:odbc driver \\d+|ole db driver) for sql server\\b|(?:microsoft )?update health tools\\b|" +
        "(?:security update|update|hotfix|gdr|обновление|исправление)\\b.*\\bkb\\d{5,}\\b)|" +
        "\\b(?:drivers?|драйвер)(?:\\s+v?\\d[\\w.-]*)?(?:\\s+\\((?:x64|x86|arm64|64-bit|32-bit)\\))?$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex SystemSoftwareName();

    public static Dictionary<string, object?> Collect(bool storeAppsEnabled)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var items = new List<Dictionary<string, object?>>();

        items.AddRange(ReadUninstallRoots(
            RegistryHive.LocalMachine,
            RegistryView.Registry64,
            @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            "machine",
            seen));

        items.AddRange(ReadUninstallRoots(
            RegistryHive.LocalMachine,
            RegistryView.Registry32,
            @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            "machine",
            seen));

        items.AddRange(ReadUninstallRoots(
            RegistryHive.CurrentUser,
            RegistryView.Registry64,
            @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            "user",
            seen));

        foreach (var sid in UserSids())
        {
            items.AddRange(ReadUninstallRoots(
                RegistryHive.Users,
                RegistryView.Registry64,
                $@"{sid}\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
                "user",
                seen));
        }

        if (storeAppsEnabled)
        {
            items.AddRange(ReadStoreApps(seen));
        }

        items = items
            .OrderBy(item => Text.Sanitize(item.GetValueOrDefault("display_name")), StringComparer.OrdinalIgnoreCase)
            .Take(Limit)
            .ToList();

        var collectedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var snapshotHash = HashItems(items);

        return new Dictionary<string, object?>
        {
            ["items"] = items,
            ["count"] = items.Count,
            ["snapshot_hash"] = snapshotHash,
            ["collected_at"] = collectedAt,
        };
    }

    private static IEnumerable<Dictionary<string, object?>> ReadUninstallRoots(
        RegistryHive hive,
        RegistryView view,
        string basePath,
        string scope,
        HashSet<string> seen)
    {
        var result = new List<Dictionary<string, object?>>();
        try
        {
            using var baseKey = RegistryKey.OpenBaseKey(hive, view);
            using var uninstall = baseKey.OpenSubKey(basePath);
            if (uninstall is null)
            {
                return result;
            }

            foreach (var subKeyName in uninstall.GetSubKeyNames())
            {
                try
                {
                    using var key = uninstall.OpenSubKey(subKeyName);
                    if (key is null)
                    {
                        continue;
                    }

                    var displayName = Text.Sanitize(key.GetValue("DisplayName"));
                    if (displayName.Length == 0)
                    {
                        continue;
                    }

                    if (Text.Truthy(Text.Sanitize(key.GetValue("SystemComponent")), false))
                    {
                        continue;
                    }

                    if (Text.Sanitize(key.GetValue("ParentKeyName")).Length > 0)
                    {
                        continue;
                    }

                    if (SystemReleaseTypes.Contains(Text.Sanitize(key.GetValue("ReleaseType"))))
                    {
                        continue;
                    }

                    if (SystemSoftwareName().IsMatch(displayName))
                    {
                        continue;
                    }

                    var version = Text.Sanitize(key.GetValue("DisplayVersion"));
                    var publisher = Text.Sanitize(key.GetValue("Publisher"));
                    var dedupeKey = $"{displayName}|{version}|{publisher}".ToLowerInvariant();
                    if (!seen.Add(dedupeKey))
                    {
                        continue;
                    }

                    result.Add(new Dictionary<string, object?>
                    {
                        ["display_name"] = displayName,
                        ["display_version"] = version,
                        ["publisher"] = publisher,
                        ["install_date"] = Text.Sanitize(key.GetValue("InstallDate")),
                        ["scope"] = scope,
                    });
                }
                catch (Exception)
                {
                    // one unreadable entry must not drop the list
                }
            }
        }
        catch (Exception)
        {
            // hive unavailable
        }

        return result;
    }

    private static List<string> UserSids()
    {
        var sids = new List<string>();
        try
        {
            using var users = Registry.Users;
            foreach (var name in users.GetSubKeyNames())
            {
                if (name.EndsWith("_Classes", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (Regex.IsMatch(name, @"^S-\d-\d+(?:-\d+)+$", RegexOptions.CultureInvariant))
                {
                    sids.Add(name);
                }
            }
        }
        catch (Exception)
        {
            // no per-user hives
        }

        return sids;
    }

    private static IEnumerable<Dictionary<string, object?>> ReadStoreApps(HashSet<string> seen)
    {
        var result = new List<Dictionary<string, object?>>();
        var json = ProcessRunner.RunPowerShellJson(
            "Get-AppxPackage -AllUsers | Where-Object { -not $_.IsFramework -and -not $_.IsResourcePackage " +
            "-and -not $_.NonRemovable -and $_.SignatureKind -eq 'Store' } | " +
            "Select-Object -Property Name,Version,Publisher -Unique | ConvertTo-Json -Compress",
            timeoutSeconds: 90);

        if (json.Length == 0)
        {
            return result;
        }

        try
        {
            var node = JsonNode.Parse(json);
            var rows = node is JsonArray array ? array : new JsonArray(node);
            foreach (var row in rows)
            {
                if (row is not JsonObject item)
                {
                    continue;
                }

                var name = Text.Sanitize(item["Name"]?.ToString());
                var normalizedName = name.ToLowerInvariant();
                if (name.Length == 0
                    || SystemStorePackages.Contains(normalizedName)
                    || SystemStorePrefixes.Any(prefix => normalizedName.StartsWith(prefix, StringComparison.Ordinal)))
                {
                    continue;
                }

                var version = Text.Sanitize(item["Version"]?.ToString());
                var publisher = PublisherCommonName(item["Publisher"]?.ToString() ?? string.Empty);
                var dedupeKey = $"{name}|{version}|{publisher}".ToLowerInvariant();
                if (!seen.Add(dedupeKey))
                {
                    continue;
                }

                result.Add(new Dictionary<string, object?>
                {
                    ["display_name"] = name,
                    ["display_version"] = version,
                    ["publisher"] = publisher,
                    ["install_date"] = string.Empty,
                    ["scope"] = "store",
                });
            }
        }
        catch (JsonException)
        {
            // malformed output: treat as no store apps
        }

        return result;
    }

    private static string PublisherCommonName(string value)
    {
        var match = Regex.Match(Text.Sanitize(value), @"CN=([^,]+)", RegexOptions.CultureInvariant);
        return match.Success ? Text.Sanitize(match.Groups[1].Value) : Text.Sanitize(value);
    }

    private static string HashItems(List<Dictionary<string, object?>> items)
    {
        var canonical = new List<string>(items.Count);
        foreach (var item in items)
        {
            var ordered = item.OrderBy(pair => pair.Key, StringComparer.Ordinal)
                .Select(pair => $"{JsonSerializer.Serialize(pair.Key)}:{JsonSerializer.Serialize(Text.Sanitize(pair.Value))}");
            canonical.Add("{" + string.Join(",", ordered) + "}");
        }

        return Text.Sha256Hex("[" + string.Join(",", canonical) + "]");
    }

    public static long FilterVersionValue => FilterVersion;
}
