namespace Hub.Desktop.DeepLinks;

public sealed record DesktopLaunchRequest(
    bool StartInBackground,
    string? Route,
    bool OpenDownloads,
    IReadOnlyList<string> SharedFiles,
    bool OpenNativeHub)
{
    public static DesktopLaunchRequest Default { get; } = new(
        StartInBackground: false,
        Route: null,
        OpenDownloads: false,
        SharedFiles: Array.Empty<string>(),
        OpenNativeHub: false);

    public bool HasSharedFiles => SharedFiles.Count > 0;

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

            if (arguments[0].Equals("--native", StringComparison.OrdinalIgnoreCase))
            {
                request = Default with { OpenNativeHub = true };
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

        // Комбинация «--native --route /tasks» (порядок аргументов не важен):
        // нативное окно сразу на указанной странице.
        if (arguments.Count == 3)
        {
            var nativeIndex = -1;
            for (var i = 0; i < arguments.Count; i++)
            {
                if (arguments[i].Equals("--native", StringComparison.OrdinalIgnoreCase))
                {
                    nativeIndex = i;
                }
            }

            if (nativeIndex >= 0)
            {
                var rest = arguments
                    .Where((_, index) => index != nativeIndex)
                    .ToList();
                if (rest.Count == 2
                    && rest[0].Equals("--route", StringComparison.OrdinalIgnoreCase)
                    && DesktopDeepLinkParser.TryParseInternalRoute(rest[1], out var nativeRoute))
                {
                    request = Default with { OpenNativeHub = true, Route = nativeRoute };
                    return true;
                }
            }
        }

        if (arguments[0].Equals("--share", StringComparison.OrdinalIgnoreCase))
        {
            var files = arguments.Skip(1).Where(path => !string.IsNullOrWhiteSpace(path)).ToList();
            request = Default with { SharedFiles = files };
            return files.Count > 0;
        }

        return false;
    }
}
