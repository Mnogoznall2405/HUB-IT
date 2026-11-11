using Microsoft.Win32;

namespace Hub.Agent.Core.Configuration;

/// <summary>
/// Machine-wide defaults written by the MSI. Process environment and .env win;
/// registry is only a fallback so an installed agent is configured by the
/// installer properties without a separate config helper executable.
/// </summary>
public static class RegistryConfig
{
    public const string KeyPath = @"SOFTWARE\HUB-IT\Agent";

    public static IReadOnlyDictionary<string, string?> LoadDefaults()
    {
        var result = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        try
        {
            using var baseKey = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
            using var key = baseKey.OpenSubKey(KeyPath);
            if (key is null)
            {
                return result;
            }

            foreach (var name in key.GetValueNames())
            {
                var value = key.GetValue(name)?.ToString();
                if (!string.IsNullOrWhiteSpace(value))
                {
                    result[name] = value;
                }
            }
        }
        catch (Exception)
        {
            // registry unavailable: defaults are optional
        }

        return result;
    }
}
