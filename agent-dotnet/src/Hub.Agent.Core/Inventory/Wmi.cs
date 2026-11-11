using System.Management;

namespace Hub.Agent.Core.Inventory;

/// <summary>
/// Thin, allocation-friendly wrapper around WMI. Every call is best-effort:
/// a missing provider or a permission error must degrade one block of the
/// inventory, never the whole report (same policy as the Python agent).
/// </summary>
public static class Wmi
{
    public const string CimV2 = @"\\.\root\cimv2";
    public const string WmiNamespace = @"\\.\root\wmi";
    public const string Storage = @"\\.\root\Microsoft\Windows\Storage";
    public const string SecurityCenter2 = @"\\.\root\SecurityCenter2";
    public const string Defender = @"\\.\root\Microsoft\Windows\Defender";
    public const string Tpm = @"\\.\root\CIMV2\Security\MicrosoftTpm";
    public const string VolumeEncryption = @"\\.\root\CIMV2\Security\MicrosoftVolumeEncryption";
    public const string StandardCimv2 = @"\\.\root\StandardCimv2";

    public static List<Dictionary<string, object?>> Query(string scopePath, string query)
    {
        var rows = new List<Dictionary<string, object?>>();
        try
        {
            var scope = new ManagementScope(scopePath);
            scope.Connect();
            using var searcher = new ManagementObjectSearcher(scope, new ObjectQuery(query));
            using var results = searcher.Get();
            foreach (ManagementBaseObject item in results)
            {
                var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
                try
                {
                    foreach (PropertyData property in item.Properties)
                    {
                        try
                        {
                            row[property.Name] = property.Value;
                        }
                        catch (Exception)
                        {
                            // one unreadable property must not drop the row
                        }
                    }
                }
                finally
                {
                    item.Dispose();
                }

                rows.Add(row);
            }
        }
        catch (Exception)
        {
            // provider unavailable / access denied: caller gets an empty list
        }

        return rows;
    }

    public static string Str(IReadOnlyDictionary<string, object?> row, string key)
    {
        if (!row.TryGetValue(key, out var value) || value is null)
        {
            return string.Empty;
        }

        return value switch
        {
            string text => Support.Text.Sanitize(text),
            string[] parts => Support.Text.Sanitize(string.Join(", ", parts)),
            ushort[] chars => DecodeCharArray(chars),
            byte[] bytes => Convert.ToHexString(bytes),
            DateTime date => date.ToString("yyyy-MM-ddTHH:mm:ss"),
            _ => Support.Text.Sanitize(value),
        };
    }

    public static long? Long(IReadOnlyDictionary<string, object?> row, string key)
    {
        if (!row.TryGetValue(key, out var value))
        {
            return null;
        }

        return Support.Text.ToLongOrNull(value);
    }

    public static long LongOrZero(IReadOnlyDictionary<string, object?> row, string key) => Long(row, key) ?? 0;

    public static bool? Bool(IReadOnlyDictionary<string, object?> row, string key)
    {
        if (!row.TryGetValue(key, out var value) || value is null)
        {
            return null;
        }

        return value switch
        {
            bool flag => flag,
            string text when bool.TryParse(text, out var parsed) => parsed,
            _ => Support.Text.ToLongOrNull(value) switch
            {
                0 => false,
                1 => true,
                _ => null,
            },
        };
    }

    public static bool BoolOr(IReadOnlyDictionary<string, object?> row, string key, bool fallback) => Bool(row, key) ?? fallback;

    public static DateTime? Date(IReadOnlyDictionary<string, object?> row, string key)
    {
        if (!row.TryGetValue(key, out var value) || value is null)
        {
            return null;
        }

        return value switch
        {
            DateTime date => date,
            string text when text.Length >= 14
                             && DateTime.TryParseExact(
                                 text[..14],
                                 "yyyyMMddHHmmss",
                                 System.Globalization.CultureInfo.InvariantCulture,
                                 System.Globalization.DateTimeStyles.None,
                                 out var cimDate) => cimDate,
            string text when DateTime.TryParse(text, out var parsed) => parsed,
            _ => null,
        };
    }

    public static string DecodeCharArray(ushort[]? chars)
    {
        if (chars is null || chars.Length == 0)
        {
            return string.Empty;
        }

        var builder = new System.Text.StringBuilder(chars.Length);
        foreach (var code in chars)
        {
            if (code == 0)
            {
                continue;
            }

            builder.Append((char)code);
        }

        return builder.ToString().Trim();
    }
}
