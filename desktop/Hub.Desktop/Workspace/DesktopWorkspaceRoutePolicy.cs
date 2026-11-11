using Hub.Desktop.Interop;

namespace Hub.Desktop.Workspace;

public static class DesktopWorkspaceRoutePolicy
{
    private static readonly string[] BlockedPathPrefixes =
    [
        "/login",
        "/shared-files",
        "/auth",
        "/reset",
    ];

    private static readonly HashSet<string> BlockedQueryKeys = new(
        [
            "access_token",
            "code",
            "download",
            "export",
            "key",
            "password",
            "refresh_token",
            "reset",
            "secret",
            "signature",
            "token",
        ],
        StringComparer.OrdinalIgnoreCase);

    public static bool TryGetSafeRoute(
        Uri trustedBaseUri,
        string? candidateUrl,
        out string route)
    {
        ArgumentNullException.ThrowIfNull(trustedBaseUri);
        route = string.Empty;

        if (!Uri.TryCreate(candidateUrl, UriKind.Absolute, out var candidate)
            || !HasSameOrigin(trustedBaseUri, candidate)
            || !string.IsNullOrEmpty(candidate.UserInfo)
            || !string.IsNullOrEmpty(candidate.Fragment))
        {
            return false;
        }

        var escapedPath = candidate.GetComponents(UriComponents.Path, UriFormat.UriEscaped);
        var path = "/" + escapedPath.TrimStart('/');
        if (path.Contains("%2f", StringComparison.OrdinalIgnoreCase)
            || path.Contains("%5c", StringComparison.OrdinalIgnoreCase)
            || path.Contains("%25", StringComparison.OrdinalIgnoreCase)
            || BlockedPathPrefixes.Any(prefix =>
                path.Equals(prefix, StringComparison.OrdinalIgnoreCase)
                || path.StartsWith(prefix + "/", StringComparison.OrdinalIgnoreCase)))
        {
            return false;
        }

        var query = candidate.GetComponents(UriComponents.Query, UriFormat.UriEscaped);
        if (ContainsBlockedQuery(query))
        {
            return false;
        }

        route = string.IsNullOrEmpty(query) ? path : $"{path}?{query}";
        return DesktopBridgeProtocol.IsValidInternalRoute(route);
    }

    private static bool HasSameOrigin(Uri trustedBaseUri, Uri candidate) =>
        string.Equals(trustedBaseUri.Scheme, candidate.Scheme, StringComparison.OrdinalIgnoreCase)
        && string.Equals(trustedBaseUri.IdnHost, candidate.IdnHost, StringComparison.OrdinalIgnoreCase)
        && trustedBaseUri.Port == candidate.Port;

    private static bool ContainsBlockedQuery(string query)
    {
        if (string.IsNullOrEmpty(query))
        {
            return false;
        }

        foreach (var pair in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var separator = pair.IndexOf('=');
            var rawKey = separator >= 0 ? pair[..separator] : pair;
            if (!TryDecodeTwice(rawKey.Replace('+', ' '), out var decodedKey))
            {
                return true;
            }

            var key = decodedKey.Trim();
            if (BlockedQueryKeys.Contains(key)
                || key.Contains("token", StringComparison.OrdinalIgnoreCase)
                || key.Contains("password", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    private static bool TryDecodeTwice(string value, out string decoded)
    {
        decoded = string.Empty;
        if (!HasValidPercentEncoding(value))
        {
            return false;
        }

        try
        {
            var decodedOnce = Uri.UnescapeDataString(value);
            if (!HasValidPercentEncoding(decodedOnce))
            {
                return false;
            }

            decoded = Uri.UnescapeDataString(decodedOnce);
            return true;
        }
        catch (UriFormatException)
        {
            return false;
        }
    }

    private static bool HasValidPercentEncoding(string value)
    {
        for (var index = 0; index < value.Length; index++)
        {
            if (value[index] != '%')
            {
                continue;
            }

            if (index + 2 >= value.Length
                || !Uri.IsHexDigit(value[index + 1])
                || !Uri.IsHexDigit(value[index + 2]))
            {
                return false;
            }

            index += 2;
        }

        return true;
    }
}
