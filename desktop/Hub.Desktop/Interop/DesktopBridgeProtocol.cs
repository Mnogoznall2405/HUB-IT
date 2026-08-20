using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Text.Json;
using Hub.Desktop.Downloads;
using Hub.Desktop.Lifecycle;
using Hub.Desktop.Shell;

namespace Hub.Desktop.Interop;

public enum DesktopInboundMessageType
{
    Ready,
    ShowNotification,
    SetTheme,
    OpenDownloadedFile,
    PrepareDownloadedFile,
    UpdateShellStatus,
    UpdateQuickRoutes,
    PrintCurrentDocument,
    OpenDownloads,
    OpenDiagnostics,
    CheckForUpdates,
    OpenCurrentInBrowser,
    VncPreflight,
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
    DesktopThemeMode? ThemeMode = null,
    DesktopShellStatus? ShellStatus = null,
    IReadOnlyList<DesktopQuickRoute>? QuickRoutes = null,
    DesktopDownloadedFileAction DownloadedFileAction = DesktopDownloadedFileAction.None);

public static class DesktopBridgeProtocol
{
    public const int CurrentVersion = 1;
    public const int MaximumInboundMessageLength = 4096;
    public const int MaximumSystemLifecycleMessageLength = 512;
    public const int MaximumNotificationIdLength = 128;
    public const int MaximumNotificationTitleLength = 128;
    public const int MaximumNotificationBodyLength = 512;
    public const int MaximumRouteLength = 1024;
    public const int MaximumWindowsUsernameLength = 50;
    public const int MaximumShellCounter = DesktopShellStatus.MaximumCounter;
    public const int MaximumQuickRoutes = 12;
    public const int MaximumQuickRouteIdLength = 32;
    public const int MaximumQuickRouteLabelLength = 48;
    private const string ReadyMessageType = "desktop.ready";
    private const string ShowNotificationMessageType = "notification.show";
    private const string SetThemeMessageType = "appearance.theme";
    private const string OpenDownloadedFileMessageType = "file.openDownloaded";
    private const string PrepareDownloadedFileMessageType = "file.prepareDownload";
    private const string ShellStatusMessageType = "shell.status";
    private const string QuickRoutesMessageType = "shell.quickRoutes";
    private const string PrintCurrentDocumentMessageType = "document.printCurrent";
    private const string OpenDownloadsMessageType = "desktop.openDownloads";
    private const string OpenDiagnosticsMessageType = "desktop.openDiagnostics";
    private const string CheckForUpdatesMessageType = "desktop.checkForUpdates";
    private const string OpenCurrentInBrowserMessageType = "desktop.openCurrentInBrowser";
    private const string VncPreflightMessageType = "remote.vncPreflight";
    private const string VncPreflightResultMessageType = "remote.vncPreflightResult";
    private const string OpenDownloadedFileResultMessageType = "file.openDownloadedResult";
    private const string PrepareDownloadedFileResultMessageType = "file.prepareDownloadResult";
    private const string HostReadyMessageType = "desktop.hostReady";
    private const string OpenNavigationMessageType = "navigation.open";
    private const string WindowStateMessageType = "desktop.windowState";
    private const string SystemResumeMessageType = "desktop.system.resume";
    private const string SystemNetworkChangedMessageType = "desktop.network.changed";
    private const string CapabilitiesMessageType = "desktop.capabilities";
    private const string OpenCommandPaletteMessageType = "command.openPalette";

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
                PrepareDownloadedFileMessageType => TryParsePrepareDownloadedFile(root, out message),
                ShellStatusMessageType => TryParseShellStatus(root, out message),
                QuickRoutesMessageType => TryParseQuickRoutes(root, out message),
                PrintCurrentDocumentMessageType => TryParsePrintCurrentDocument(root, out message),
                OpenDownloadsMessageType => TryParseExactCommand(
                    root,
                    DesktopInboundMessageType.OpenDownloads,
                    out message),
                OpenDiagnosticsMessageType => TryParseExactCommand(
                    root,
                    DesktopInboundMessageType.OpenDiagnostics,
                    out message),
                CheckForUpdatesMessageType => TryParseExactCommand(
                    root,
                    DesktopInboundMessageType.CheckForUpdates,
                    out message),
                OpenCurrentInBrowserMessageType => TryParseExactCommand(
                    root,
                    DesktopInboundMessageType.OpenCurrentInBrowser,
                    out message),
                VncPreflightMessageType => TryParseExactCommand(
                    root,
                    DesktopInboundMessageType.VncPreflight,
                    out message),
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

    public static string CreateCapabilitiesMessage()
    {
        return JsonSerializer.Serialize(new
        {
            type = CapabilitiesMessageType,
            version = CurrentVersion,
            capabilities = new[]
            {
                "command-palette",
                "desktop-actions",
                "file-actions-v2",
                "print",
                "quick-routes",
                "shell-status",
                "vnc-preflight",
            },
        });
    }

    public static string CreateOpenCommandPaletteMessage() =>
        JsonSerializer.Serialize(new
        {
            type = OpenCommandPaletteMessageType,
            version = CurrentVersion,
        });

    public static string CreateWindowStateMessage(bool foreground)
    {
        return JsonSerializer.Serialize(new
        {
            type = WindowStateMessageType,
            version = CurrentVersion,
            foreground,
        });
    }

    public static string CreateSystemLifecycleMessage(DesktopSystemLifecycleMessage message)
    {
        ArgumentNullException.ThrowIfNull(message);
        if (message.Generation < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(message), "Generation must be a positive integer.");
        }

        var occurredUtc = message.OccurredUtc.ToUniversalTime()
            .ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);
        var json = message.Kind switch
        {
            DesktopSystemLifecycleKind.Resume => JsonSerializer.Serialize(new
            {
                type = SystemResumeMessageType,
                version = CurrentVersion,
                generation = message.Generation,
                occurredUtc,
            }),
            DesktopSystemLifecycleKind.NetworkChanged when message.NetworkAvailable is bool available =>
                JsonSerializer.Serialize(new
                {
                    type = SystemNetworkChangedMessageType,
                    version = CurrentVersion,
                    generation = message.Generation,
                    available,
                    occurredUtc,
                }),
            _ => throw new ArgumentOutOfRangeException(nameof(message), "Unsupported system lifecycle message."),
        };

        if (json.Length > MaximumSystemLifecycleMessageLength)
        {
            throw new InvalidOperationException("System lifecycle message exceeds the size limit.");
        }

        return json;
    }

    public static string CreateOpenDownloadedFileResultMessage(bool accepted)
    {
        return JsonSerializer.Serialize(new
        {
            type = OpenDownloadedFileResultMessageType,
            version = CurrentVersion,
            status = accepted ? "accepted" : "busy",
        });
    }

    public static string CreatePrepareDownloadedFileResultMessage(
        DesktopDownloadedFileAction action,
        bool accepted)
    {
        if (action == DesktopDownloadedFileAction.None)
        {
            throw new ArgumentOutOfRangeException(nameof(action));
        }

        return JsonSerializer.Serialize(new
        {
            type = PrepareDownloadedFileResultMessageType,
            version = CurrentVersion,
            action = FormatDownloadedFileAction(action),
            status = accepted ? "accepted" : "busy",
        });
    }

    public static string CreateVncPreflightResultMessage(bool available)
    {
        return JsonSerializer.Serialize(new
        {
            type = VncPreflightResultMessageType,
            version = CurrentVersion,
            status = available ? "available" : "missing",
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

    private static bool TryParsePrepareDownloadedFile(
        JsonElement root,
        out DesktopInboundMessage message)
    {
        message = default!;
        if (!HasExactProperties(root, "type", "version", "action")
            || !TryGetBoundedString(root, "action", 8, out var actionText))
        {
            return false;
        }

        var action = actionText switch
        {
            "open" => DesktopDownloadedFileAction.Open,
            "print" => DesktopDownloadedFileAction.Print,
            "copy" => DesktopDownloadedFileAction.Copy,
            "saveAs" => DesktopDownloadedFileAction.SaveAs,
            _ => DesktopDownloadedFileAction.None,
        };
        if (action == DesktopDownloadedFileAction.None)
        {
            return false;
        }

        message = new DesktopInboundMessage(
            DesktopInboundMessageType.PrepareDownloadedFile,
            DownloadedFileAction: action);
        return true;
    }

    private static bool TryParseShellStatus(JsonElement root, out DesktopInboundMessage message)
    {
        message = default!;
        if (!HasExactProperties(
                root,
                "type",
                "version",
                "authenticated",
                "online",
                "unread_total",
                "chat_unread",
                "mail_unread",
                "tasks_attention")
            || !TryGetBoolean(root, "authenticated", out var authenticated)
            || !TryGetBoolean(root, "online", out var online)
            || !TryGetShellCounter(root, "unread_total", out var unreadTotal)
            || !TryGetShellCounter(root, "chat_unread", out var chatUnread)
            || !TryGetShellCounter(root, "mail_unread", out var mailUnread)
            || !TryGetShellCounter(root, "tasks_attention", out var tasksAttention))
        {
            return false;
        }

        message = new DesktopInboundMessage(
            DesktopInboundMessageType.UpdateShellStatus,
            ShellStatus: new DesktopShellStatus(
                authenticated,
                online,
                unreadTotal,
                chatUnread,
                mailUnread,
                tasksAttention));
        return true;
    }

    private static bool TryParseQuickRoutes(JsonElement root, out DesktopInboundMessage message)
    {
        message = default!;
        if (!HasExactProperties(root, "type", "version", "routes")
            || !root.TryGetProperty("routes", out var routesElement)
            || routesElement.ValueKind != JsonValueKind.Array
            || routesElement.GetArrayLength() > MaximumQuickRoutes)
        {
            return false;
        }

        var routes = new List<DesktopQuickRoute>(routesElement.GetArrayLength());
        var routeIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var routeElement in routesElement.EnumerateArray())
        {
            if (routeElement.ValueKind != JsonValueKind.Object
                || !HasExactProperties(routeElement, "id", "label", "route", "badge")
                || !TryGetBoundedString(routeElement, "id", MaximumQuickRouteIdLength, out var id)
                || !TryGetBoundedString(routeElement, "label", MaximumQuickRouteLabelLength, out var label)
                || !TryGetBoundedString(routeElement, "route", MaximumRouteLength, out var route)
                || !TryGetShellCounter(routeElement, "badge", out var badge)
                || !IsValidQuickRouteId(id)
                || !IsValidInternalRoute(route)
                || !routeIds.Add(id))
            {
                return false;
            }

            routes.Add(new DesktopQuickRoute(id, label, route, badge));
        }

        message = new DesktopInboundMessage(
            DesktopInboundMessageType.UpdateQuickRoutes,
            QuickRoutes: routes);
        return true;
    }

    private static bool TryParsePrintCurrentDocument(
        JsonElement root,
        out DesktopInboundMessage message)
    {
        message = default!;
        if (!HasExactProperties(root, "type", "version"))
        {
            return false;
        }

        message = new DesktopInboundMessage(DesktopInboundMessageType.PrintCurrentDocument);
        return true;
    }

    private static bool TryParseExactCommand(
        JsonElement root,
        DesktopInboundMessageType type,
        out DesktopInboundMessage message)
    {
        message = default!;
        if (!HasExactProperties(root, "type", "version"))
        {
            return false;
        }

        message = new DesktopInboundMessage(type);
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

    private static bool TryGetBoolean(JsonElement root, string propertyName, out bool value)
    {
        value = false;
        if (!root.TryGetProperty(propertyName, out var element)
            || element.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
        {
            return false;
        }

        value = element.GetBoolean();
        return true;
    }

    private static bool TryGetShellCounter(JsonElement root, string propertyName, out int value)
    {
        value = 0;
        return root.TryGetProperty(propertyName, out var element)
            && element.TryGetInt32(out value)
            && value >= 0
            && value <= MaximumShellCounter;
    }

    private static bool IsValidNotificationId(string value)
    {
        return value.All(character =>
            char.IsAsciiLetterOrDigit(character)
            || character is '-' or '_' or ':' or '.');
    }

    private static bool IsValidQuickRouteId(string value)
    {
        return char.IsAsciiLetter(value[0])
            && value.All(character =>
                char.IsAsciiLetterOrDigit(character)
                || character == '-');
    }

    private static string FormatDownloadedFileAction(DesktopDownloadedFileAction action) =>
        action switch
        {
            DesktopDownloadedFileAction.Open => "open",
            DesktopDownloadedFileAction.Print => "print",
            DesktopDownloadedFileAction.Copy => "copy",
            DesktopDownloadedFileAction.SaveAs => "saveAs",
            _ => throw new ArgumentOutOfRangeException(nameof(action)),
        };

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
