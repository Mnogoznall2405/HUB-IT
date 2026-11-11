using Microsoft.Win32;
using Hub.Agent.Core.Configuration;
using Hub.Agent.Core.Support;

namespace Hub.Agent.Core.Inventory.Collectors;

/// <summary>Antivirus, BitLocker, firewall, Defender, RDP, local admins, Secure Boot and TPM.</summary>
public static class SecurityCollector
{
    private static readonly Dictionary<long, string> ProtectionStatusNames = new()
    {
        [0] = "Off",
        [1] = "On",
        [2] = "Unknown",
    };

    private static readonly Dictionary<long, string> ConversionStatusNames = new()
    {
        [0] = "FullyDecrypted",
        [1] = "FullyEncrypted",
        [2] = "EncryptionInProgress",
        [3] = "DecryptionInProgress",
        [4] = "EncryptionPaused",
        [5] = "DecryptionPaused",
    };

    public static Dictionary<string, object?> Collect(AgentConfig config)
    {
        var security = new Dictionary<string, object?>
        {
            ["antivirus"] = Antivirus(),
            ["bitlocker"] = SystemDriveBitLocker(),
        };

        if (!config.SecurityPostureEnabled)
        {
            return security;
        }

        foreach (var (key, value) in Posture())
        {
            security[key] = value;
        }

        return security;
    }

    private static List<Dictionary<string, object?>> Antivirus()
    {
        var items = new List<Dictionary<string, object?>>();
        foreach (var row in Wmi.Query(Wmi.SecurityCenter2, "SELECT displayName,productState FROM AntiVirusProduct"))
        {
            items.Add(new Dictionary<string, object?>
            {
                ["display_name"] = Wmi.Str(row, "displayName"),
                ["product_state"] = Wmi.Str(row, "productState"),
            });
        }

        return items;
    }

    private static Dictionary<string, object?> SystemDriveBitLocker()
    {
        var result = new Dictionary<string, object?>
        {
            ["system_drive_protection"] = "unknown",
            ["system_drive_status"] = string.Empty,
        };

        var volume = Volumes().FirstOrDefault(row =>
            string.Equals(Text.Sanitize(Wmi.Str(row, "DriveLetter")), "C:", StringComparison.OrdinalIgnoreCase));
        if (volume is null)
        {
            return result;
        }

        var protection = Wmi.Long(volume, "ProtectionStatus") ?? 2;
        result["system_drive_protection"] = ProtectionStatusNames.TryGetValue(protection, out var protectionName) ? protectionName : "unknown";
        var conversion = Wmi.Long(volume, "ConversionStatus");
        result["system_drive_status"] = conversion is { } value && ConversionStatusNames.TryGetValue(value, out var conversionName)
            ? conversionName
            : string.Empty;
        return result;
    }

    private static IEnumerable<Dictionary<string, object?>> Volumes()
        => Wmi.Query(Wmi.VolumeEncryption, "SELECT DriveLetter,ProtectionStatus,ConversionStatus FROM Win32_EncryptableVolume");

    private static Dictionary<string, object?> Posture()
    {
        var posture = new Dictionary<string, object?>();

        var firewall = Wmi.Query(Wmi.StandardCimv2, "SELECT Name,Enabled FROM MSFT_NetFirewallProfile");
        if (firewall.Count > 0)
        {
            posture["firewall"] = firewall
                .Select(row => new Dictionary<string, object?>
                {
                    ["name"] = Wmi.Str(row, "Name"),
                    ["enabled"] = Wmi.Long(row, "Enabled") is 1,
                })
                .ToList();
        }
        else
        {
            var fallback = FirewallFromRegistry();
            if (fallback.Count > 0)
            {
                posture["firewall"] = fallback;
            }
        }

        var defender = Wmi.Query(
            Wmi.Defender,
            "SELECT RealTimeProtectionEnabled,AntivirusSignatureLastUpdated,AntivirusSignatureVersion FROM MSFT_MpComputerStatus");
        if (defender.Count > 0)
        {
            var row = defender[0];
            var updated = Wmi.Date(row, "AntivirusSignatureLastUpdated");
            if (updated is not null)
            {
                posture["defender"] = new Dictionary<string, object?>
                {
                    ["realtime"] = Wmi.BoolOr(row, "RealTimeProtectionEnabled", false),
                    ["signature_updated"] = updated.Value.ToString("yyyy-MM-ddTHH:mm:ss"),
                    ["signature_version"] = Wmi.Str(row, "AntivirusSignatureVersion"),
                };
            }
        }

        if (TryReadDword(RegistryHive.LocalMachine, @"SYSTEM\CurrentControlSet\Control\Terminal Server", "fDenyTSConnections") is { } deny)
        {
            posture["rdp_enabled"] = deny == 0;
        }

        var admins = LocalAdmins();
        if (admins.Count > 0)
        {
            posture["local_admins"] = admins;
        }

        if (TryReadDword(RegistryHive.LocalMachine, @"SYSTEM\CurrentControlSet\Control\SecureBoot\State", "UEFISecureBootEnabled") is { } secureBoot)
        {
            posture["secure_boot"] = secureBoot == 1;
        }

        var tpm = Wmi.Query(Wmi.Tpm, "SELECT IsPresent,IsEnabled_InitialValue,IsActivated_InitialValue FROM Win32_Tpm");
        if (tpm.Count > 0)
        {
            var row = tpm[0];
            posture["tpm"] = new Dictionary<string, object?>
            {
                ["present"] = Wmi.BoolOr(row, "IsPresent", false),
                ["ready"] = Wmi.BoolOr(row, "IsEnabled_InitialValue", false) && Wmi.BoolOr(row, "IsActivated_InitialValue", false),
            };
        }
        else
        {
            // No Win32_Tpm instance means the platform exposes no TPM; Get-Tpm
            // reports the same pair on such machines.
            posture["tpm"] = new Dictionary<string, object?>
            {
                ["present"] = false,
                ["ready"] = false,
            };
        }

        var volumes = Volumes().ToList();
        if (volumes.Count > 0)
        {
            posture["bitlocker_volumes"] = volumes
                .Select(row =>
                {
                    var mount = Text.Sanitize(Wmi.Str(row, "DriveLetter"));
                    if (mount.Length == 2 && mount[1] == ':')
                    {
                        mount += "\\";
                    }

                    var protection = Wmi.Long(row, "ProtectionStatus") ?? 2;
                    var conversion = Wmi.Long(row, "ConversionStatus") ?? 2;
                    return new Dictionary<string, object?>
                    {
                        ["mount"] = mount,
                        ["protection"] = ProtectionStatusNames.TryGetValue(protection, out var protectionName) ? protectionName : "Unknown",
                        ["status"] = ConversionStatusNames.TryGetValue(conversion, out var conversionName) ? conversionName : string.Empty,
                    };
                })
                .ToList();
        }

        return posture;
    }

    private static List<Dictionary<string, object?>> FirewallFromRegistry()
    {
        var result = new List<Dictionary<string, object?>>();
        var profiles = new (string Name, string Path)[]
        {
            ("Domain", @"SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters\FirewallPolicy\DomainProfile"),
            ("Private", @"SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters\FirewallPolicy\StandardProfile"),
            ("Public", @"SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters\FirewallPolicy\PublicProfile"),
        };

        foreach (var (name, path) in profiles)
        {
            if (TryReadDword(RegistryHive.LocalMachine, path, "EnableFirewall") is not { } enabled)
            {
                continue;
            }

            result.Add(new Dictionary<string, object?>
            {
                ["name"] = name,
                ["enabled"] = enabled != 0,
            });
        }

        return result;
    }

    private static List<string> LocalAdmins()
    {
        var names = new List<string>();
        var rows = Wmi.Query(Wmi.CimV2, "SELECT GroupComponent,PartComponent FROM Win32_GroupUser");
        foreach (var row in rows)
        {
            var group = Wmi.Str(row, "GroupComponent");
            if (!group.Contains("Name=\"Administrators\"", StringComparison.OrdinalIgnoreCase)
                && !group.Contains("Name=\"Администраторы\"", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var part = Wmi.Str(row, "PartComponent");
            var domain = ExtractCimValue(part, "Domain");
            var name = ExtractCimValue(part, "Name");
            if (name.Length == 0)
            {
                continue;
            }

            names.Add(domain.Length > 0 ? $"{domain}\\{name}" : name);
        }

        return names.Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(value => value, StringComparer.OrdinalIgnoreCase).ToList();
    }

    private static string ExtractCimValue(string component, string key)
    {
        var marker = key + "=";
        var index = component.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (index < 0)
        {
            return string.Empty;
        }

        var tail = component[(index + marker.Length)..].TrimStart();
        if (tail.Length == 0)
        {
            return string.Empty;
        }

        if (tail[0] == '"')
        {
            var end = tail.IndexOf('"', 1);
            return end > 0 ? tail[1..end] : string.Empty;
        }

        var separator = tail.IndexOfAny(new[] { ',', '}' });
        return separator < 0 ? tail : tail[..separator];
    }

    private static long? TryReadDword(RegistryHive hive, string path, string name)
    {
        try
        {
            using var baseKey = RegistryKey.OpenBaseKey(hive, RegistryView.Registry64);
            using var key = baseKey.OpenSubKey(path);
            if (key?.GetValue(name) is int value)
            {
                return value;
            }
        }
        catch (Exception)
        {
            // best effort
        }

        return null;
    }
}
