using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Hub.Agent.Core.Configuration;
using Hub.Agent.Core.Diagnostics;
using Hub.Agent.Core.Support;

namespace Hub.Agent.Core.Inventory.Collectors;

/// <summary>
/// Sizes of user profiles (per top-level folder). Faithful port of the Python
/// collector: same budgets, skip list, partial reasons and payload shape.
/// Results are cached for 24 hours, like the original.
/// </summary>
public static class ProfileSizesCollector
{
    public const int CacheVersion = 2;
    private const int TtlSeconds = 24 * 60 * 60;
    private const int DefaultProfileBudgetSec = 45;
    private const int DefaultTotalBudgetSec = 180;
    private const int DefaultMaxEntriesPerProfile = 500_000;
    private const int MaxProfiles = 50;

    private static readonly HashSet<string> SkipDirNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "$recycle.bin", ".cache", ".git", ".svn", "cache", "caches", "crashdumps", "logs", "node_modules", "temp", "tmp",
    };

    private static readonly HashSet<string> IgnoredProfileDirs = new(StringComparer.OrdinalIgnoreCase)
    {
        "all users", "default", "default user", "defaultappspool", "public",
    };

    private static readonly HashSet<string> PartialReasonNames = new(StringComparer.Ordinal)
    {
        "timeout", "entry_limit", "total_timeout",
    };

    public static Dictionary<string, object?> Collect(
        AgentPaths paths,
        AgentLog log,
        bool allowScan,
        bool forceRefresh = false,
        bool persistState = true)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var limits = Limits();
        var cached = LoadCache(paths, log);
        var cachedAt = cached is null ? 0 : Text.ToLong(cached["collected_at"], 0);

        if (cached is not null && !forceRefresh && cachedAt > 0 && now - cachedAt < TtlSeconds && CacheMatches(cached, limits))
        {
            return cached;
        }

        if (!allowScan)
        {
            return cached is not null && cachedAt > 0 ? cached : EmptyPayload();
        }

        var total = Stopwatch.StartNew();
        var totalDeadline = total.Elapsed + TimeSpan.FromSeconds(
            Text.ToInt(Text.Sanitize(limits.GetValueOrDefault("total_budget_sec")), DefaultTotalBudgetSec));
        var profiles = new List<Dictionary<string, object?>>();
        var partial = false;
        var partialReasons = new List<string>();

        foreach (var profilePath in EnumerateProfiles(MaxProfiles))
        {
            if (total.Elapsed >= totalDeadline)
            {
                partial = true;
                AddPartialReason(partialReasons, "total_timeout");
                break;
            }

            var item = CollectProfile(profilePath, totalDeadline, limits);
            profiles.Add(item);
            partial = partial || item["partial"] is true;
            foreach (var reason in (List<string>)(item["partial_reasons"] ?? new List<string>()))
            {
                AddPartialReason(partialReasons, reason);
            }

            if (total.Elapsed >= totalDeadline && item["partial"] is true)
            {
                AddPartialReason(partialReasons, "total_timeout");
            }
        }

        var payload = new Dictionary<string, object?>
        {
            ["cache_version"] = CacheVersion,
            ["collected_at"] = now,
            ["profiles_count"] = profiles.Count,
            ["total_size_bytes"] = profiles.Sum(item => Text.ToLong(item.GetValueOrDefault("total_size_bytes"), 0)),
            ["profiles"] = profiles,
            ["partial"] = partial,
            ["partial_reasons"] = partialReasons,
            ["duration_ms"] = (long)total.ElapsedMilliseconds,
            ["limits"] = limits,
        };

        if (persistState)
        {
            SaveCache(paths, payload, log);
        }
        log.Info(
            $"User profile sizes collected: profiles={payload["profiles_count"]} " +
            $"total_bytes={payload["total_size_bytes"]} partial={partial}");

        return payload;
    }

    private static Dictionary<string, object?> EmptyPayload() => new()
    {
        ["cache_version"] = CacheVersion,
        ["collected_at"] = 0,
        ["profiles_count"] = 0,
        ["total_size_bytes"] = 0,
        ["profiles"] = new List<Dictionary<string, object?>>(),
        ["partial"] = false,
        ["partial_reasons"] = new List<string>(),
        ["limits"] = Limits(),
    };

    private static Dictionary<string, object?> Limits() => new()
    {
        ["profile_budget_sec"] = EnvInt("ITINV_USER_PROFILE_SIZE_PROFILE_BUDGET_SEC", DefaultProfileBudgetSec),
        ["total_budget_sec"] = EnvInt("ITINV_USER_PROFILE_SIZE_TOTAL_BUDGET_SEC", DefaultTotalBudgetSec),
        ["max_entries_per_profile"] = EnvInt("ITINV_USER_PROFILE_SIZE_MAX_ENTRIES_PER_PROFILE", DefaultMaxEntriesPerProfile),
        ["max_profiles"] = MaxProfiles,
    };

    private static int EnvInt(string name, int fallback)
    {
        var raw = Environment.GetEnvironmentVariable(name);
        return Math.Max(1, Text.ToInt(raw, fallback));
    }

    private static IEnumerable<string> EnumerateProfiles(int limit)
    {
        const string usersRoot = @"C:\Users";
        if (!Directory.Exists(usersRoot))
        {
            return Array.Empty<string>();
        }

        try
        {
            return Directory.EnumerateDirectories(usersRoot)
                .OrderBy(path => Path.GetFileName(path), StringComparer.OrdinalIgnoreCase)
                .Where(path =>
                {
                    var name = Path.GetFileName(path);
                    if (IgnoredProfileDirs.Contains(name))
                    {
                        return false;
                    }

                    try
                    {
                        return !new DirectoryInfo(path).Attributes.HasFlag(FileAttributes.ReparsePoint);
                    }
                    catch (Exception)
                    {
                        return false;
                    }
                })
                .Take(limit)
                .ToList();
        }
        catch (Exception)
        {
            return Array.Empty<string>();
        }
    }

    private static Dictionary<string, object?> CollectProfile(
        string profilePath,
        TimeSpan totalDeadline,
        IReadOnlyDictionary<string, object?> limits)
    {
        var started = Stopwatch.StartNew();
        var profileDeadline = TimeSpan.FromSeconds(Math.Min(
            totalDeadline.TotalSeconds,
            started.Elapsed.TotalSeconds + Text.ToInt(
                Text.Sanitize(limits.GetValueOrDefault("profile_budget_sec")),
                DefaultProfileBudgetSec)));
        var maxEntries = Text.ToInt(
            Text.Sanitize(limits.GetValueOrDefault("max_entries_per_profile")),
            DefaultMaxEntriesPerProfile);

        long entriesSeen = 0;
        long totalSize = 0;
        long filesCount = 0;
        long dirsCount = 0;
        long errorsCount = 0;
        var partial = false;
        var partialReasons = new List<string>();
        var topLevelFolders = new List<Dictionary<string, object?>>();

        List<string> children;
        try
        {
            children = Directory.EnumerateFileSystemEntries(profilePath)
                .OrderBy(path => Path.GetFileName(path), StringComparer.OrdinalIgnoreCase)
                .ToList();
        }
        catch (Exception)
        {
            children = new List<string>();
            errorsCount++;
        }

        foreach (var child in children)
        {
            if (started.Elapsed >= profileDeadline)
            {
                partial = true;
                AddPartialReason(partialReasons, "timeout");
                break;
            }

            if (entriesSeen >= maxEntries)
            {
                partial = true;
                AddPartialReason(partialReasons, "entry_limit");
                break;
            }

            FileAttributes attributes;
            try
            {
                attributes = File.GetAttributes(child);
            }
            catch (Exception)
            {
                errorsCount++;
                continue;
            }

            if (attributes.HasFlag(FileAttributes.ReparsePoint))
            {
                continue;
            }

            if (!attributes.HasFlag(FileAttributes.Directory))
            {
                try
                {
                    totalSize += Math.Max(0, new FileInfo(child).Length);
                    filesCount++;
                    entriesSeen++;
                }
                catch (Exception)
                {
                    errorsCount++;
                }

                continue;
            }

            if (SkipDirNames.Contains(Path.GetFileName(child)))
            {
                continue;
            }

            var remaining = (int)Math.Max(1, maxEntries - entriesSeen);
            var folder = CollectTreeSize(child, profileDeadline, remaining);
            entriesSeen += folder.Entries;
            totalSize += folder.Size;
            filesCount += folder.Files;
            dirsCount += folder.Dirs;
            errorsCount += folder.Errors;
            partial = partial || folder.Partial;
            foreach (var reason in folder.PartialReasons)
            {
                AddPartialReason(partialReasons, reason);
            }

            topLevelFolders.Add(new Dictionary<string, object?>
            {
                ["name"] = Path.GetFileName(child),
                ["path"] = child,
                ["size_bytes"] = folder.Size,
                ["files_count"] = folder.Files,
                ["dirs_count"] = folder.Dirs,
                ["errors_count"] = folder.Errors,
                ["partial"] = folder.Partial,
                ["partial_reason"] = folder.PartialReasons.FirstOrDefault() ?? string.Empty,
                ["partial_reasons"] = folder.PartialReasons,
            });
        }

        topLevelFolders.Sort((left, right) =>
            Text.ToLong(right.GetValueOrDefault("size_bytes"), 0).CompareTo(Text.ToLong(left.GetValueOrDefault("size_bytes"), 0)));

        return new Dictionary<string, object?>
        {
            ["user_name"] = Path.GetFileName(profilePath),
            ["profile_path"] = profilePath,
            ["total_size_bytes"] = totalSize,
            ["top_level_folders"] = topLevelFolders,
            ["files_count"] = filesCount,
            ["dirs_count"] = dirsCount,
            ["errors_count"] = errorsCount,
            ["duration_ms"] = started.ElapsedMilliseconds,
            ["partial"] = partial,
            ["partial_reason"] = partialReasons.FirstOrDefault() ?? string.Empty,
            ["partial_reasons"] = partialReasons,
        };
    }

    private sealed record TreeSize(long Size, long Files, long Dirs, long Errors, long Entries, bool Partial, List<string> PartialReasons);

    private static TreeSize CollectTreeSize(string root, TimeSpan deadline, int maxEntries)
    {
        long size = 0;
        long files = 0;
        long dirs = 0;
        long errors = 0;
        long entries = 0;
        var partial = false;
        var reasons = new List<string>();
        var stopwatch = Stopwatch.StartNew();

        var stack = new Stack<string>();
        stack.Push(root);

        while (stack.Count > 0)
        {
            if (stopwatch.Elapsed >= deadline)
            {
                partial = true;
                AddPartialReason(reasons, "timeout");
                break;
            }

            if (entries >= maxEntries)
            {
                partial = true;
                AddPartialReason(reasons, "entry_limit");
                break;
            }

            var current = stack.Pop();
            FileAttributes attributes;
            try
            {
                attributes = File.GetAttributes(current);
            }
            catch (Exception)
            {
                errors++;
                continue;
            }

            if (attributes.HasFlag(FileAttributes.ReparsePoint))
            {
                continue;
            }

            if (!attributes.HasFlag(FileAttributes.Directory))
            {
                try
                {
                    size += Math.Max(0, new FileInfo(current).Length);
                    files++;
                    entries++;
                }
                catch (Exception)
                {
                    errors++;
                }

                continue;
            }

            dirs++;
            entries++;
            try
            {
                foreach (var child in Directory.EnumerateFileSystemEntries(current))
                {
                    if (stopwatch.Elapsed >= deadline)
                    {
                        partial = true;
                        AddPartialReason(reasons, "timeout");
                        break;
                    }

                    if (entries >= maxEntries)
                    {
                        partial = true;
                        AddPartialReason(reasons, "entry_limit");
                        break;
                    }

                    FileAttributes childAttributes;
                    try
                    {
                        childAttributes = File.GetAttributes(child);
                    }
                    catch (Exception)
                    {
                        errors++;
                        continue;
                    }

                    if (childAttributes.HasFlag(FileAttributes.ReparsePoint))
                    {
                        continue;
                    }

                    if (childAttributes.HasFlag(FileAttributes.Directory))
                    {
                        if (SkipDirNames.Contains(Path.GetFileName(child)))
                        {
                            continue;
                        }

                        stack.Push(child);
                    }
                    else
                    {
                        try
                        {
                            size += Math.Max(0, new FileInfo(child).Length);
                            files++;
                            entries++;
                        }
                        catch (Exception)
                        {
                            errors++;
                        }
                    }
                }
            }
            catch (Exception)
            {
                errors++;
            }
        }

        return new TreeSize(size, files, dirs, errors, entries, partial, reasons);
    }

    private static void AddPartialReason(List<string> reasons, string reason)
    {
        var value = Text.Sanitize(reason).ToLowerInvariant();
        if (PartialReasonNames.Contains(value) && !reasons.Contains(value))
        {
            reasons.Add(value);
        }
    }

    private static Dictionary<string, object?>? LoadCache(AgentPaths paths, AgentLog log)
    {
        try
        {
            if (!File.Exists(paths.ProfileSizesCacheFile))
            {
                return null;
            }

            var node = JsonNode.Parse(File.ReadAllText(paths.ProfileSizesCacheFile));
            if (node is not JsonObject obj)
            {
                return null;
            }

            return ToDictionary(obj);
        }
        catch (Exception ex)
        {
            log.Warn($"User profile sizes cache read failed: {ex.Message}");
            return null;
        }
    }

    private static void SaveCache(AgentPaths paths, Dictionary<string, object?> payload, AgentLog log)
    {
        try
        {
            AtomicFile.WriteAllText(paths.ProfileSizesCacheFile, JsonSerializer.Serialize(payload));
        }
        catch (Exception ex)
        {
            log.Warn($"User profile sizes cache write failed: {ex.Message}");
        }
    }

    private static bool CacheMatches(Dictionary<string, object?>? cached, Dictionary<string, object?> limits)
    {
        if (cached is null)
        {
            return false;
        }

        if (Text.ToLong(cached.GetValueOrDefault("cache_version"), 0) != CacheVersion)
        {
            return false;
        }

        if (cached.GetValueOrDefault("limits") is not Dictionary<string, object?> cachedLimits)
        {
            return false;
        }

        return cachedLimits.Count == limits.Count
               && limits.All(pair =>
                   Text.ToLong(cachedLimits.GetValueOrDefault(pair.Key), 0) == Text.ToLong(pair.Value, 0));
    }

    private static Dictionary<string, object?> ToDictionary(JsonObject obj)
    {
        var result = new Dictionary<string, object?>();
        foreach (var pair in obj)
        {
            result[pair.Key] = FromNode(pair.Value);
        }

        return result;
    }

    private static object? FromNode(JsonNode? node)
    {
        switch (node)
        {
            case null:
                return null;
            case JsonObject obj:
                return ToDictionary(obj);
            case JsonArray array:
                return array.Select(FromNode).ToList();
            case JsonValue value:
                if (value.TryGetValue<long>(out var number))
                {
                    return number;
                }

                if (value.TryGetValue<bool>(out var flag))
                {
                    return flag;
                }

                return value.ToString();
            default:
                return null;
        }
    }

    public static string DescribeLimits(IReadOnlyDictionary<string, object?> limits)
        => string.Join(", ", limits.Select(pair => $"{pair.Key}={pair.Value}"));
}
