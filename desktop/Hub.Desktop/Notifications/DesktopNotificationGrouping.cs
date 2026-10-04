using System.Security.Cryptography;
using System.Text;

namespace Hub.Desktop.Notifications;

/// <summary>
/// Computes Windows app notification Tag/Group from a validated notification request.
/// Windows limits both values to 64 characters; longer values are replaced by a stable hash.
/// </summary>
internal static class DesktopNotificationGrouping
{
    public const int MaximumLength = 64;

    public static string? GetTag(string? id)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            return null;
        }

        return Limit("id", id.Trim());
    }

    public static string? GetGroup(string? route)
    {
        if (string.IsNullOrWhiteSpace(route))
        {
            return null;
        }

        try
        {
            var (path, query) = SplitRoute(route.Trim());
            if (path.Equals("/chat", StringComparison.OrdinalIgnoreCase))
            {
                var conversationId = GetQueryValue(query, "conversation");
                return conversationId is null ? null : Limit("chat", $"chat:{conversationId}");
            }

            if (path.Equals("/tasks", StringComparison.OrdinalIgnoreCase)
                && string.Equals(
                    GetQueryValue(query, "task_detail_view"),
                    "discussion",
                    StringComparison.OrdinalIgnoreCase))
            {
                var taskId = GetQueryValue(query, "task");
                return taskId is null ? null : Limit("task", $"task:{taskId}");
            }
        }
        catch (Exception)
        {
            // Grouping is cosmetic: a malformed route must never break notification display.
        }

        return null;
    }

    private static (string Path, string Query) SplitRoute(string route)
    {
        var fragmentIndex = route.IndexOf('#');
        if (fragmentIndex >= 0)
        {
            route = route[..fragmentIndex];
        }

        var queryIndex = route.IndexOf('?');
        return queryIndex >= 0
            ? (route[..queryIndex].TrimEnd('/'), route[(queryIndex + 1)..])
            : (route.TrimEnd('/'), string.Empty);
    }

    private static string? GetQueryValue(string query, string name)
    {
        foreach (var pair in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var separator = pair.IndexOf('=');
            if (separator <= 0)
            {
                continue;
            }

            var key = Uri.UnescapeDataString(pair[..separator].Replace('+', ' '));
            if (!key.Equals(name, StringComparison.Ordinal))
            {
                continue;
            }

            var value = Uri.UnescapeDataString(pair[(separator + 1)..].Replace('+', ' ')).Trim();
            return value.Length == 0 || value.Any(char.IsControl) ? null : value;
        }

        return null;
    }

    private static string Limit(string prefix, string value)
    {
        if (value.Length <= MaximumLength)
        {
            return value;
        }

        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)))
            .ToLowerInvariant();
        var hashed = $"{prefix}#{hash}";
        return hashed.Length <= MaximumLength ? hashed : hashed[..MaximumLength];
    }
}
