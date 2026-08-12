namespace Hub.Desktop.Notifications;

internal static class DesktopNotificationPresentation
{
    public static string GetPrimaryActionLabel(string route) =>
        IsReplyRoute(route) ? "Ответить" : "Открыть";

    private static bool IsReplyRoute(string route)
    {
        if (string.IsNullOrWhiteSpace(route))
        {
            return false;
        }

        return IsRouteOrQuery(route, "/chat") || IsRouteOrQuery(route, "/mail");
    }

    private static bool IsRouteOrQuery(string route, string expectedRoute) =>
        route.Equals(expectedRoute, StringComparison.OrdinalIgnoreCase)
        || route.StartsWith($"{expectedRoute}?", StringComparison.OrdinalIgnoreCase);
}
