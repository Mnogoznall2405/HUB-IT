using System.Runtime.InteropServices;
using Hub.Agent.Core.Inventory;
using Hub.Agent.Core.Support;

namespace Hub.Agent.Core.FsEgress;

/// <summary>Drive/profile roots and path classification (parity with fs_egress/roots.py).</summary>
public static class FsEgressRoots
{
    private const uint DriveRemovable = 2;
    private const uint DriveFixed = 3;
    private const uint DriveRemote = 4;

    private static readonly string[] ProfileSubdirs = { "Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music" };

    private static readonly string[] IgnoreFragments =
    {
        "\\appdata\\local\\temp\\",
        "\\appdata\\local\\microsoft\\windows\\inetcache\\",
        "\\node_modules\\",
        "\\.git\\",
        "\\$recycle.bin\\",
        "\\system volume information\\",
        "\\windows\\",
    };

    private static readonly string[] SkipProfiles = { "public", "default", "default user", "all users", "defaultapppool" };

    private static readonly object UsbGate = new();
    private static DateTime _usbCachedAt = DateTime.MinValue;
    private static HashSet<string> _usbLetters = new(StringComparer.OrdinalIgnoreCase);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern uint GetDriveTypeW(string rootPathName);

    [DllImport("kernel32.dll")]
    private static extern uint GetLogicalDrives();

    public static List<string> RemovableRoots()
    {
        var roots = new List<string>();
        var usbLetters = UsbBusDriveLetters();
        foreach (var drive in LogicalDrives())
        {
            var type = DriveType(drive);
            var letter = drive[..1].ToUpperInvariant();
            if (type == DriveRemovable || (type == DriveFixed && usbLetters.Contains(letter)))
            {
                if (Directory.Exists(drive))
                {
                    roots.Add(drive);
                }
            }
        }

        return roots;
    }

    public static List<string> RemoteRoots(bool depthFallback = true)
    {
        var roots = new List<string>();
        foreach (var drive in LogicalDrives())
        {
            if (DriveType(drive) != DriveRemote)
            {
                continue;
            }

            var foundNamed = false;
            foreach (var sub in ProfileSubdirs)
            {
                var candidate = Path.Combine(drive, sub);
                if (Directory.Exists(candidate))
                {
                    roots.Add(candidate);
                    foundNamed = true;
                }
            }

            if (!foundNamed && depthFallback && Directory.Exists(drive))
            {
                roots.Add(drive);
            }
        }

        return roots;
    }

    public static List<string> ProfileRoots()
    {
        var roots = new List<string>();
        var users = Path.Combine(Environment.GetEnvironmentVariable("SystemDrive") ?? "C:", "Users");
        if (!Directory.Exists(users))
        {
            return roots;
        }

        IEnumerable<string> profiles;
        try
        {
            profiles = Directory.EnumerateDirectories(users);
        }
        catch (Exception)
        {
            return roots;
        }

        foreach (var profile in profiles)
        {
            var name = Path.GetFileName(profile);
            if (SkipProfiles.Contains(name, StringComparer.OrdinalIgnoreCase))
            {
                continue;
            }

            foreach (var sub in ProfileSubdirs)
            {
                var candidate = Path.Combine(profile, sub);
                if (Directory.Exists(candidate))
                {
                    roots.Add(candidate);
                }
            }

            try
            {
                foreach (var child in Directory.EnumerateDirectories(profile, "OneDrive*"))
                {
                    roots.Add(child);
                }
            }
            catch (Exception)
            {
                // profile is not readable
            }
        }

        return roots;
    }

    public static string ClassifyPath(string path)
    {
        var text = Text.Sanitize(path);
        if (text.Length == 0)
        {
            return "unknown";
        }

        if (text.StartsWith(@"\\", StringComparison.Ordinal))
        {
            return "network";
        }

        try
        {
            var drive = Path.GetPathRoot(text);
            if (string.IsNullOrEmpty(drive))
            {
                return "unknown";
            }

            var type = DriveType(drive);
            if (type == DriveRemovable)
            {
                return "usb";
            }

            if (type == DriveRemote)
            {
                return "network";
            }

            if (type == DriveFixed)
            {
                return UsbBusDriveLetters().Contains(drive[..1].ToUpperInvariant()) ? "usb" : "local";
            }
        }
        catch (Exception)
        {
            // fall through
        }

        return "unknown";
    }

    public static bool ShouldIgnorePath(string path)
    {
        var normalized = Text.Sanitize(path).Replace('/', '\\').ToLowerInvariant();
        if (normalized.Length == 0)
        {
            return true;
        }

        var name = Path.GetFileName(normalized);
        if (name is "." or ".." || name.StartsWith("~$", StringComparison.Ordinal))
        {
            return true;
        }

        if (IgnoreFragments.Any(fragment => normalized.Contains(fragment, StringComparison.Ordinal)))
        {
            return true;
        }

        return normalized.Contains(@"\system volume information", StringComparison.Ordinal)
               || normalized.EndsWith(@"\$recycle.bin", StringComparison.Ordinal);
    }

    public static IEnumerable<string> UniqueExisting(IEnumerable<string> paths)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var path in paths)
        {
            string resolved;
            try
            {
                resolved = Path.GetFullPath(path);
            }
            catch (Exception)
            {
                resolved = path;
            }

            if (resolved.Length == 0 || !seen.Add(resolved) || !Directory.Exists(resolved))
            {
                continue;
            }

            yield return resolved;
        }
    }

    public static List<string> LogicalDrives()
    {
        var result = new List<string>();
        uint mask;
        try
        {
            mask = GetLogicalDrives();
        }
        catch (Exception)
        {
            return result;
        }

        for (var index = 0; index < 26; index++)
        {
            if ((mask & (1u << index)) != 0)
            {
                result.Add($"{(char)('A' + index)}:\\");
            }
        }

        return result;
    }

    public static uint DriveType(string root)
    {
        try
        {
            return GetDriveTypeW(root);
        }
        catch (Exception)
        {
            return 0;
        }
    }

    /// <summary>Letters of drives on the USB bus (external HDD/SSD often report DRIVE_FIXED).</summary>
    public static HashSet<string> UsbBusDriveLetters()
    {
        lock (UsbGate)
        {
            if (DateTime.UtcNow - _usbCachedAt < TimeSpan.FromMinutes(1))
            {
                return _usbLetters;
            }

            var letters = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                var disks = Wmi.Query(Wmi.Storage, "SELECT Number FROM MSFT_Disk WHERE BusType=7");
                var numbers = disks
                    .Select(row => Wmi.Long(row, "Number"))
                    .Where(number => number is not null)
                    .Select(number => number!.Value)
                    .ToList();

                foreach (var number in numbers)
                {
                    var partitions = Wmi.Query(
                        Wmi.Storage,
                        $"SELECT DriveLetter FROM MSFT_Partition WHERE DiskNumber={number} AND DriveLetter IS NOT NULL");
                    foreach (var partition in partitions)
                    {
                        var letter = Wmi.Str(partition, "DriveLetter").Trim();
                        if (letter.Length == 1 && char.IsAsciiLetter(letter[0]))
                        {
                            letters.Add(letter.ToUpperInvariant());
                        }
                    }
                }
            }
            catch (Exception)
            {
                // storage provider unavailable: only DRIVE_REMOVABLE will be detected
            }

            _usbLetters = letters;
            _usbCachedAt = DateTime.UtcNow;
            return letters;
        }
    }
}
