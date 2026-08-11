namespace Hub.Desktop.Security;

public enum NavigationDisposition
{
    TrustedOrigin,
    ExternalBrowser,
    Blocked,
}

public sealed class NavigationPolicy
{
    private readonly string _trustedOrigin;

    public NavigationPolicy(Uri trustedBaseUri)
    {
        ArgumentNullException.ThrowIfNull(trustedBaseUri);
        _trustedOrigin = NormalizeOrigin(trustedBaseUri);
        TrustedOriginForLog = $"{trustedBaseUri.Scheme}://{trustedBaseUri.IdnHost}:{trustedBaseUri.Port}";
    }

    public string TrustedOriginForLog { get; }

    public NavigationDisposition Evaluate(string? rawUri)
    {
        if (!Uri.TryCreate(rawUri, UriKind.Absolute, out var uri))
        {
            return NavigationDisposition.Blocked;
        }

        if (IsTrustedOrigin(uri))
        {
            return NavigationDisposition.TrustedOrigin;
        }

        return IsAllowedExternalScheme(uri)
            ? NavigationDisposition.ExternalBrowser
            : NavigationDisposition.Blocked;
    }

    public bool IsTrustedOrigin(Uri uri)
    {
        ArgumentNullException.ThrowIfNull(uri);
        return string.Equals(_trustedOrigin, NormalizeOrigin(uri), StringComparison.Ordinal);
    }

    public bool IsAllowedExternalScheme(string? rawUri)
    {
        return Uri.TryCreate(rawUri, UriKind.Absolute, out var uri) && IsAllowedExternalScheme(uri);
    }

    public bool TryGetExternalUri(string? rawUri, out Uri uri)
    {
        if (Uri.TryCreate(rawUri, UriKind.Absolute, out var parsed)
            && !IsTrustedOrigin(parsed)
            && IsAllowedExternalScheme(parsed))
        {
            uri = parsed;
            return true;
        }

        uri = null!;
        return false;
    }

    public static string GetSchemeForLog(string? rawUri)
    {
        return Uri.TryCreate(rawUri, UriKind.Absolute, out var uri)
            ? uri.Scheme
            : "invalid";
    }

    private static bool IsAllowedExternalScheme(Uri uri)
    {
        return uri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            || uri.Scheme.Equals(Uri.UriSchemeMailto, StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizeOrigin(Uri uri)
    {
        return $"{uri.Scheme.ToLowerInvariant()}://{uri.IdnHost.ToLowerInvariant()}:{uri.Port}";
    }
}
