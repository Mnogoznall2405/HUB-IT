using System.Net;

namespace Hub.Desktop.Security;

public enum NavigationDisposition
{
    TrustedOrigin,
    SsoRedirect,
    ExternalBrowser,
    Blocked,
}

public sealed class NavigationPolicy
{
    private readonly string _trustedOrigin;
    private readonly string? _ssoAuthorityOrigin;

    public NavigationPolicy(Uri trustedBaseUri, Uri? ssoAuthority = null)
    {
        ArgumentNullException.ThrowIfNull(trustedBaseUri);
        _trustedOrigin = NormalizeOrigin(trustedBaseUri);
        _ssoAuthorityOrigin = ssoAuthority is null ? null : NormalizeOrigin(ssoAuthority);
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

        if (IsSsoRedirect(uri))
        {
            return NavigationDisposition.SsoRedirect;
        }

        return IsAllowedExternalScheme(uri)
            ? NavigationDisposition.ExternalBrowser
            : NavigationDisposition.Blocked;
    }

    /// <summary>
    /// In-window navigation to the AD FS authority is allowed only under /adfs/
    /// (authorize, WIA, signout). The origin stays untrusted: no bridge messages,
    /// no external-scheme launches, no downloads.
    /// </summary>
    public bool IsSsoRedirect(Uri uri)
    {
        return _ssoAuthorityOrigin is not null
            && string.Equals(_ssoAuthorityOrigin, NormalizeOrigin(uri), StringComparison.Ordinal)
            && uri.AbsolutePath.StartsWith("/adfs/", StringComparison.OrdinalIgnoreCase);
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
            || uri.Scheme.Equals(Uri.UriSchemeMailto, StringComparison.OrdinalIgnoreCase)
            || uri.Scheme.Equals("tg", StringComparison.OrdinalIgnoreCase)
            || uri.Scheme.Equals("vnc", StringComparison.OrdinalIgnoreCase)
            || IsPrivateIpv4HttpUri(uri);
    }

    private static bool IsPrivateIpv4HttpUri(Uri uri)
    {
        if (!uri.Scheme.Equals(Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
            || uri.HostNameType != UriHostNameType.IPv4
            || !string.IsNullOrEmpty(uri.UserInfo)
            || !IPAddress.TryParse(uri.Host, out var address))
        {
            return false;
        }

        var bytes = address.GetAddressBytes();
        return bytes.Length == 4
            && (bytes[0] == 10
                || (bytes[0] == 172 && bytes[1] is >= 16 and <= 31)
                || (bytes[0] == 192 && bytes[1] == 168));
    }

    private static string NormalizeOrigin(Uri uri)
    {
        return $"{uri.Scheme.ToLowerInvariant()}://{uri.IdnHost.ToLowerInvariant()}:{uri.Port}";
    }
}
