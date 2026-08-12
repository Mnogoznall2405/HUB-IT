using System.Text.RegularExpressions;

namespace Hub.Desktop.Diagnostics;

public static partial class DesktopRedaction
{
    private const string Replacement = "[REDACTED]";

    public static string Redact(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return string.Empty;
        }

        var redacted = UrlPattern().Replace(value, RedactUrl);
        redacted = AuthorizationHeaderPattern().Replace(redacted, "$1" + Replacement);
        redacted = CookieHeaderPattern().Replace(redacted, "$1" + Replacement);
        redacted = JsonSecretPattern().Replace(redacted, "$1" + Replacement + "$2");
        redacted = FormSecretPattern().Replace(redacted, "$1=" + Replacement);
        return BearerPattern().Replace(redacted, "Bearer " + Replacement);
    }

    private static string RedactUrl(Match match)
    {
        if (!Uri.TryCreate(match.Value, UriKind.Absolute, out var uri))
        {
            return Replacement;
        }

        var builder = new UriBuilder(uri)
        {
            Query = string.Empty,
            Fragment = string.Empty,
            UserName = string.Empty,
            Password = string.Empty,
        };
        return builder.Uri.AbsoluteUri.TrimEnd('/');
    }

    [GeneratedRegex(@"\bhttps?://[^\s""'<>]+", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex UrlPattern();

    [GeneratedRegex(@"(?im)^(\s*authorization\s*:\s*)[^\r\n]+", RegexOptions.CultureInvariant)]
    private static partial Regex AuthorizationHeaderPattern();

    [GeneratedRegex(@"(?im)^(\s*(?:cookie|set-cookie)\s*:\s*)[^\r\n]+", RegexOptions.CultureInvariant)]
    private static partial Regex CookieHeaderPattern();

    [GeneratedRegex(@"(?i)(""(?:access_token|refresh_token|id_token|password|cookie)""\s*:\s*"")[^""]*("")", RegexOptions.CultureInvariant)]
    private static partial Regex JsonSecretPattern();

    [GeneratedRegex(@"(?i)\b(access_token|refresh_token|id_token|token|password|cookie)=([^&\s;]+)", RegexOptions.CultureInvariant)]
    private static partial Regex FormSecretPattern();

    [GeneratedRegex(@"(?i)\bbearer\s+[a-z0-9._~+/=-]+", RegexOptions.CultureInvariant)]
    private static partial Regex BearerPattern();
}
