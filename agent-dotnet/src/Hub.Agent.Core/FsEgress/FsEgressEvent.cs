using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Hub.Agent.Core.Support;

namespace Hub.Agent.Core.FsEgress;

/// <summary>File-left event and identity helpers (parity with fs_egress/events.py).</summary>
public static class FsEgressEvent
{
    private static readonly HashSet<string> SkipProfileNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "public", "default", "default user", "all users", "defaultapppool",
    };

    public static Dictionary<string, object?> Build(
        string channel,
        string destPath,
        string fileName = "",
        string srcPath = "",
        long? size = null,
        bool computeHash = false,
        Dictionary<string, object?>? details = null)
    {
        var dest = Text.Sanitize(destPath);
        var src = Text.Sanitize(srcPath);
        var name = Text.Sanitize(fileName);
        if (name.Length == 0)
        {
            name = SafeFileName(dest);
        }

        var (user, host) = HostIdentity(dest.Length > 0 ? dest : src);
        var sha = string.Empty;
        long? resolvedSize = size;
        var eventDetails = details is null
            ? new Dictionary<string, object?>()
            : new Dictionary<string, object?>(details);

        var exists = false;
        try
        {
            exists = File.Exists(dest);
        }
        catch (Exception)
        {
            eventDetails["metadata_unavailable"] = true;
        }

        if (exists)
        {
            try
            {
                if (resolvedSize is null)
                {
                    resolvedSize = new FileInfo(dest).Length;
                }
            }
            catch (Exception)
            {
                eventDetails["metadata_unavailable"] = true;
            }

            if (computeHash)
            {
                sha = TrySha256(dest);
                if (sha.Length == 0)
                {
                    eventDetails["metadata_unavailable"] = true;
                }
            }
        }

        return new Dictionary<string, object?>
        {
            ["event_id"] = Guid.NewGuid().ToString("N"),
            ["ts"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            ["channel"] = channel,
            ["file_name"] = name,
            ["dest_path"] = dest,
            ["src_path"] = src,
            ["size"] = resolvedSize,
            ["sha256"] = sha,
            ["windows_user"] = user,
            ["computer_name"] = host,
            ["details"] = eventDetails,
        };
    }

    public static string UserFromProfilePath(string path)
    {
        try
        {
            var parts = Text.Sanitize(path).Split('\\', StringSplitOptions.RemoveEmptyEntries);
            for (var index = 0; index < parts.Length - 1; index++)
            {
                if (!parts[index].Equals("Users", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var name = Text.Sanitize(parts[index + 1]);
                return name.Length > 0 && !SkipProfileNames.Contains(name) ? name : string.Empty;
            }
        }
        catch (Exception)
        {
            // malformed path
        }

        return string.Empty;
    }

    public static (string User, string Host) HostIdentity(string pathHint)
    {
        var user = Text.Sanitize(Environment.GetEnvironmentVariable("USERNAME"));
        var host = Text.Sanitize(Environment.GetEnvironmentVariable("COMPUTERNAME"));
        if (host.Length == 0)
        {
            host = Environment.MachineName;
        }

        if (user.Length == 0 || user.EndsWith('$') ||
            user.Equals("system", StringComparison.OrdinalIgnoreCase) ||
            user.Equals("local service", StringComparison.OrdinalIgnoreCase) ||
            user.Equals("network service", StringComparison.OrdinalIgnoreCase))
        {
            var fromPath = UserFromProfilePath(pathHint);
            if (fromPath.Length > 0)
            {
                user = fromPath;
            }
            else
            {
                var interactive = InteractiveWindowsUser();
                if (interactive.Length > 0)
                {
                    user = interactive;
                }
            }
        }

        return (user, host);
    }

    private static string TrySha256(string path)
    {
        const int maxBytes = 2 * 1024 * 1024;
        try
        {
            var info = new FileInfo(path);
            if (info.Length <= 0 || info.Length > maxBytes)
            {
                return string.Empty;
            }

            using var stream = File.OpenRead(path);
            using var sha = SHA256.Create();
            var digest = sha.ComputeHash(stream);
            return Convert.ToHexString(digest).ToLowerInvariant();
        }
        catch (Exception)
        {
            return string.Empty;
        }
    }

    private static string SafeFileName(string path)
    {
        try
        {
            return Path.GetFileName(Text.Sanitize(path));
        }
        catch (Exception)
        {
            return string.Empty;
        }
    }

    [DllImport("wtsapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool WTSQuerySessionInformationW(
        IntPtr server,
        int sessionId,
        int infoClass,
        out IntPtr buffer,
        out int bytesReturned);

    [DllImport("wtsapi32.dll")]
    private static extern void WTSFreeMemory(IntPtr memory);

    [DllImport("kernel32.dll")]
    private static extern uint WTSGetActiveConsoleSessionId();

    private static string InteractiveWindowsUser()
    {
        try
        {
            var sessionId = WTSGetActiveConsoleSessionId();
            if (sessionId == uint.MaxValue)
            {
                return string.Empty;
            }

            const int wtsUserName = 5;
            if (!WTSQuerySessionInformationW(IntPtr.Zero, (int)sessionId, wtsUserName, out var buffer, out _))
            {
                return string.Empty;
            }

            try
            {
                return Marshal.PtrToStringUni(buffer)?.Trim() ?? string.Empty;
            }
            finally
            {
                WTSFreeMemory(buffer);
            }
        }
        catch (Exception)
        {
            return string.Empty;
        }
    }
}
