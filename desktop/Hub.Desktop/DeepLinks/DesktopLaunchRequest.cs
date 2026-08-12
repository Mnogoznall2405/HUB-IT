namespace Hub.Desktop.DeepLinks;

public sealed record DesktopLaunchRequest(
    bool StartInBackground,
    string? Route,
    bool OpenDownloads)
{
    public static DesktopLaunchRequest Default { get; } = new(
        StartInBackground: false,
        Route: null,
        OpenDownloads: false);

    public static bool TryParse(IReadOnlyList<string> arguments, out DesktopLaunchRequest request)
    {
        ArgumentNullException.ThrowIfNull(arguments);
        request = Default;

        if (arguments.Count == 0)
        {
            return true;
        }

        if (arguments.Count == 1)
        {
            if (arguments[0].Equals("--background", StringComparison.OrdinalIgnoreCase))
            {
                request = Default with { StartInBackground = true };
                return true;
            }

            if (arguments[0].Equals("--downloads", StringComparison.OrdinalIgnoreCase))
            {
                request = Default with { OpenDownloads = true };
                return true;
            }

            if (DesktopDeepLinkParser.TryParseProtocolUri(arguments[0], out var protocolRoute))
            {
                request = Default with { Route = protocolRoute };
                return true;
            }

            return false;
        }

        if (arguments.Count == 2
            && arguments[0].Equals("--route", StringComparison.OrdinalIgnoreCase)
            && DesktopDeepLinkParser.TryParseInternalRoute(arguments[1], out var route))
        {
            request = Default with { Route = route };
            return true;
        }

        return false;
    }
}
