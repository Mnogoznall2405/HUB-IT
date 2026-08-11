using System.Diagnostics.CodeAnalysis;
using System.Text.Json;

namespace Hub.Desktop.Interop;

public enum DesktopInboundMessageType
{
    Ready,
    ShowNotification,
    SetTheme,
    OpenDownloadedFile,
}

public enum DesktopThemeMode
{
    Light,
    Dark,
}

public sealed record DesktopNotificationRequest(string Id, string Title, string Body, string Route);

public sealed record DesktopInboundMessage(
    DesktopInboundMessageType Type,
    DesktopNotificationRequest? Notification = null,
    DesktopThemeMode? ThemeMode = null);

public static class DesktopBridgeProtocol
{
    public const int CurrentVersion = 1;
    public const int MaximumInboundMessageLength = 4096;
    public const int MaximumNotificationIdLength = 128;
    public const int MaximumNotificationTitleLength = 128;
    public const int MaximumNotificationBodyLength = 512;
    public const int MaximumRouteLength = 1024;
    public const int MaximumWindowsUsernameLength = 50;
    private const string ReadyMessageType = "desktop.ready";
    private const string ShowNotificationMessageType = "notification.show";
    private const string SetThemeMessageType = "appearance.theme";
    private const string OpenDownloadedFileMessageType = "file.openDownloaded";
    private const string HostReadyMessageType = "desktop.hostReady";
    private const string OpenNavigationMessageType = "navigation.open";
    private const string WindowStateMessageType = "desktop.windowState";

    public static bool TryParseInbound(string? json, out DesktopInboundMessage message)
    {
        message = default!;

        if (string.IsNullOrWhiteSpace(json) || json.Length > MaximumInboundMessageLength)
        {
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;

            if (root.ValueKind != JsonValueKind.Object || root.GetRawText().Length > MaximumInboundMessageLength)
            {
                return false;
            }

            if (!root.TryGetProperty("type", out var typeElement)
                || typeElement.ValueKind != JsonValueKind.String
                || !root.TryGetProperty("version", out var versionElement)
                || !versionElement.TryGetInt32(out var version)
                || version != CurrentVersion)
            {
                return false;
            }

            return typeElement.GetString() switch
            {
                ReadyMessageType => TryParseReady(root, out message),
                ShowNotificationMessageType => TryParseNotification(root, out message),
                SetThemeMessageType => TryParseTheme(root, out message),
                OpenDownloadedFileMessageType => TryParseOpenDownloadedFile(root, out message),
                _ => false,
            };
        }
        catch (JsonException)
        {
            return false;
        }
    }

    public static string CreateHostReadyMessage(bool notificationsAvailable, string? windowsUsername)
    {
        var normalizedWindowsUsername = NormalizeWindowsUsername(windowsUsername);

        return JsonSerializer.Serialize(new
        {
            type = HostReadyMessageType,
            version = CurrentVersion,
            capabilities = new
            {
                notifications = notificationsAvailable,
            },
            windowsUsername = normalizedWindowsUsername,
        });
    }

    public static string CreateOpenNavigationMessage(string route)
    {
        if (!IsValidInternalRoute(route))
        {
            throw new ArgumentException("Route must be a safe internal path.", nameof(route));
        }

        return JsonSerializer.Serialize(new
        {
            type = OpenNavigationMessageType,
            version = CurrentVersion,
            route,
        });
    }

    public static string CreateWindowStateMessage(bool foreground)
    {
        return JsonSerializer.Serialize(new
        {
            type = WindowStateMessageType,
            version = CurrentVersion,
            foreground,
        });
    }

    private static bool TryParseReady(JsonElement root, out DesktopInboundMessage message)
    {
        message = default!;
        if (!HasExactProperties(root, "type", "version"))
        {
            return false;
        }

        message = new DesktopInboundMessage(DesktopInboundMessageType.Ready);
        return true;
    }

    private static bool TryParseNotification(JsonElement root, out DesktopInboundMessage message)
    {
        message = default!;
        if (!HasExactProperties(root, "type", "version", "id", "title", "body", "route")
            || !TryGetBoundedString(root, "id", MaximumNotificationIdLength, out var id)
            || !TryGetBoundedString(root, "title", MaximumNotificationTitleLength, out var title)
            || !TryGetBoundedString(root, "body", MaximumNotificationBodyLength, out var body)
            || !TryGetBoundedString(root, "route", MaximumRouteLength, out var route)
            || !IsValidNotificationId(id)
            || !IsValidInternalRoute(route))
        {
            return false;
        }

        message = new DesktopInboundMessage(
            DesktopInboundMessageType.ShowNotification,
            new DesktopNotificationRequest(id, title, body, route));
        return true;
    }

    private static bool TryParseTheme(JsonElement root, out DesktopInboundMessage message)
    {
        message = default!;
        if (!HasExactProperties(root, "type", "version", "mode")
            || !TryGetBoundedString(root, "mode", 5, out var mode))
        {
            return false;
        }

        var themeMode = mode switch
        {
            "light" => DesktopThemeMode.Light,
            "dark" => DesktopThemeMode.Dark,
            _ => (DesktopThemeMode?)null,
        };
        if (themeMode is null)
        {
            return false;
        }

        message = new DesktopInboundMessage(
            DesktopInboundMessageType.SetTheme,
            ThemeMode: themeMode);
        return true;
    }

    private static bool TryParseOpenDownloadedFile(JsonElement root, out DesktopInboundMessage message)
    {
        message = default!;
        if (!HasExactProperties(root, "type", "version"))
        {
            return false;
        }

        message = new DesktopInboundMessage(DesktopInboundMessageType.OpenDownloadedFile);
        return true;
    }

    private static bool HasExactProperties(JsonElement root, params string[] expectedNames)
    {
        var expected = new HashSet<string>(expectedNames, StringComparer.Ordinal);
        var propertyCount = 0;

        foreach (var property in root.EnumerateObject())
        {
            propertyCount++;
            if (!expected.Contains(property.Name))
            {
                return false;
            }
        }

        return propertyCount == expected.Count;
    }

    private static bool TryGetBoundedString(
        JsonElement root,
        string propertyName,
        int maximumLength,
        out string value)
    {
        value = string.Empty;
        if (!root.TryGetProperty(propertyName, out var element)
            || element.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        value = element.GetString() ?? string.Empty;
        return !string.IsNullOrWhiteSpace(value)
            && value.Length <= maximumLength
            && !value.Any(char.IsControl);
    }

    private static bool IsValidNotificationId(string value)
    {
        return value.All(character =>
            char.IsAsciiLetterOrDigit(character)
            || character is '-' or '_' or ':' or '.');
    }

    private static string? NormalizeWindowsUsername(string? value)
    {
        var normalized = value?.Trim();
        return !string.IsNullOrWhiteSpace(normalized)
            && normalized.Length <= MaximumWindowsUsernameLength
            && !normalized.Any(char.IsControl)
                ? normalized
                : null;
    }

    public static bool IsValidInternalRoute([NotNullWhen(true)] string? value)
    {
        return !string.IsNullOrWhiteSpace(value)
            && value.Length <= MaximumRouteLength
            && !value.Any(char.IsControl)
            && value[0] == '/'
            && !value.StartsWith("//", StringComparison.Ordinal)
            && !value.Contains('\\')
            && Uri.TryCreate(value, UriKind.Relative, out _);
    }
}
