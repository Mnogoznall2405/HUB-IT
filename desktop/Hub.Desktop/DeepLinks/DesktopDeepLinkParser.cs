using Hub.Desktop.Interop;
using Hub.Desktop.Workspace;

namespace Hub.Desktop.DeepLinks;

public static class DesktopDeepLinkParser
{
    public const int MaximumInputLength = 2048;
    private static readonly Uri ValidationOrigin = new("https://hub.invalid/");
    private static readonly HashSet<string> ExactPaths = new(
        [
            "/",
            "/address-book",
            "/chat",
            "/company-structure",
            "/computers",
            "/dashboard",
            "/database",
            "/docflow",
            "/feed",
            "/kb",
            "/mail",
            "/mfu",
            "/my-files",
            "/networks",
            "/profile",
            "/scan-center",
            "/settings",
            "/statistics",
            "/tasks",
            "/tickets",
            "/vcs",
            "/warehouse-1c",
        ],
        StringComparer.OrdinalIgnoreCase);

    public static bool TryParseProtocolUri(string? value, out string route)
    {
        route = string.Empty;
        if (string.IsNullOrWhiteSpace(value)
            || value.Length > MaximumInputLength
            || value.Contains('\\')
            || !Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || !uri.Scheme.Equals("hubit", StringComparison.OrdinalIgnoreCase)
            || !uri.Host.Equals("open", StringComparison.OrdinalIgnoreCase)
            || !uri.IsDefaultPort
            || !string.IsNullOrEmpty(uri.UserInfo)
            || !string.IsNullOrEmpty(uri.Fragment))
        {
            return false;
        }

        var rawPathAndQuery = uri.GetComponents(
            UriComponents.PathAndQuery,
            UriFormat.UriEscaped);
        return TryParseInternalRoute("/" + rawPathAndQuery.TrimStart('/'), out route);
    }

    public static bool TryParseInternalRoute(string? value, out string route)
    {
        route = string.Empty;
        if (string.IsNullOrWhiteSpace(value)
            || value.Length > MaximumInputLength
            || value.Contains('#')
            || !DesktopBridgeProtocol.IsValidInternalRoute(value)
            || !Uri.TryCreate(ValidationOrigin, value, out var candidate)
            || !DesktopWorkspaceRoutePolicy.TryGetSafeRoute(
                ValidationOrigin,
                candidate.AbsoluteUri,
                out var normalizedRoute))
        {
            return false;
        }

        var path = candidate.AbsolutePath.TrimEnd('/');
        if (path.Length == 0)
        {
            path = "/";
        }

        if (!ExactPaths.Contains(path) && !IsAllowedParameterizedPath(path))
        {
            return false;
        }

        route = normalizedRoute;
        return true;
    }

    private static bool IsAllowedParameterizedPath(string path)
    {
        if (!path.StartsWith("/networks/", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var branchId = path["/networks/".Length..];
        return branchId.Length is > 0 and <= 128
            && !branchId.Contains('/')
            && branchId.All(character =>
                char.IsAsciiLetterOrDigit(character)
                || character is '-' or '_' or '.' or '~');
    }
}
