using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Hub.Agent.Core.Support;

/// <summary>
/// String helpers mirroring the Python agent's normalization rules.
/// Every value that goes into the inventory payload passes through here so the
/// server sees the same shape it saw from the Python agent.
/// </summary>
public static partial class Text
{
    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();

    [GeneratedRegex(@"^[A-Z][A-Z0-9_]*$")]
    private static partial Regex EnvNameRegex();

    public static string Sanitize(object? value)
    {
        if (value is null)
        {
            return string.Empty;
        }

        if (value is string text)
        {
            return text.Replace("\0", string.Empty, StringComparison.Ordinal).Trim();
        }

        if (value is IFormattable formattable)
        {
            return formattable.ToString(null, CultureInfo.InvariantCulture)?.Replace("\0", string.Empty, StringComparison.Ordinal).Trim()
                ?? string.Empty;
        }

        return value.ToString()?.Replace("\0", string.Empty, StringComparison.Ordinal).Trim() ?? string.Empty;
    }

    public static string CompactSpaces(string? value) => WhitespaceRegex().Replace(Sanitize(value), " ").Trim();

    public static bool Truthy(string? value, bool fallback)
    {
        var normalized = Sanitize(value).ToLowerInvariant();
        if (normalized.Length == 0)
        {
            return fallback;
        }

        return normalized is "1" or "true" or "yes" or "y" or "on" or "да";
    }

    public static int ToInt(string? value, int fallback)
    {
        var raw = Sanitize(value);
        if (raw.Length == 0)
        {
            return fallback;
        }

        if (int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
        {
            return parsed;
        }

        if (double.TryParse(raw.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var asDouble))
        {
            return (int)asDouble;
        }

        return fallback;
    }

    public static long? ToLongOrNull(object? value)
    {
        switch (value)
        {
            case null:
                return null;
            case bool flag:
                return flag ? 1 : 0;
            case long l:
                return l;
            case ulong ul when ul <= long.MaxValue:
                return (long)ul;
            case int i:
                return i;
            case uint ui:
                return ui;
            case short s:
                return s;
            case ushort us:
                return us;
            case byte b:
                return b;
            case float f when !float.IsNaN(f):
                return (long)f;
            case double d when !double.IsNaN(d):
                return (long)d;
            case decimal m:
                return (long)m;
        }

        var text = Sanitize(value).Replace(',', '.');
        if (text.Length == 0)
        {
            return null;
        }

        if (long.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedLong))
        {
            return parsedLong;
        }

        if (double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsedDouble))
        {
            return (long)parsedDouble;
        }

        return null;
    }

    public static long ToLong(object? value, long fallback) => ToLongOrNull(value) ?? fallback;

    public static List<string> Dedupe(IEnumerable<string?> values)
    {
        var result = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var value in values)
        {
            var normalized = Sanitize(value);
            if (normalized.Length == 0 || !seen.Add(normalized))
            {
                continue;
            }

            result.Add(normalized);
        }

        return result;
    }

    public static string Sha256Hex(string value)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    public static string Sha256Hex(byte[] value) => Convert.ToHexString(SHA256.HashData(value)).ToLowerInvariant();

    public static double Round(double value, int digits) => Math.Round(value, digits, MidpointRounding.ToEven);

    public static bool IsValidEnvName(string name) => EnvNameRegex().IsMatch(name);
}
