using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Win32;
using Hub.Agent.Core.Configuration;
using Hub.Agent.Core.Diagnostics;
using Hub.Agent.Core.Support;

namespace Hub.Agent.Core.Inventory.Collectors;

/// <summary>
/// Outlook PST/OST discovery and active-store selection. Same scan locations,
/// state file and payload shape as the Python collector.
/// </summary>
public static partial class OutlookCollector
{
    private const long WarningThresholdBytes = 45L * 1024 * 1024 * 1024;
    private const long CriticalThresholdBytes = 49L * 1024 * 1024 * 1024;
    private const int StateMaxAgeSeconds = 30 * 24 * 60 * 60;
    private const string DefaultExtraRoot = @"D:\";

    private static readonly string[] ProfilePatterns =
    {
        @"AppData\Local\Microsoft\Outlook\*.ost",
        @"AppData\Roaming\Microsoft\Outlook\*.pst",
        @"Documents\Outlook Files\*.pst",
        @"Documents\Файлы Outlook\*.pst",
        @"Документы\Outlook Files\*.pst",
        @"Документы\Файлы Outlook\*.pst",
    };

    private static readonly HashSet<string> ExtraRootSkipDirs = new(StringComparer.OrdinalIgnoreCase)
    {
        "windows", "program files", "program files (x86)", "programdata", "$recycle.bin",
        "system volume information", "recovery", "perflogs",
    };

    private static readonly object CacheGate = new();
    private static string _cachedUser = string.Empty;
    private static long _cachedAt;
    private static Dictionary<string, object?>? _cachedPayload;

    [GeneratedRegex(@"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex EmailRegex();

    [GeneratedRegex(@"^(archive|архив)(?:$|[ _.\-].*)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex ArchiveNameRegex();

    public static Dictionary<string, object?> Collect(
        string userLogin,
        AgentConfig config,
        AgentPaths paths,
        AgentLog log,
        bool forceRefresh,
        bool persistState = true)
    {
        var normalizedUser = HostCollector.NormalizeLogin(userLogin).ToLowerInvariant();
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        lock (CacheGate)
        {
            if (!forceRefresh
                && _cachedPayload is not null
                && string.Equals(_cachedUser, normalizedUser, StringComparison.Ordinal)
                && now - _cachedAt <= config.OutlookRefreshSec)
            {
                return new Dictionary<string, object?>(_cachedPayload);
            }
        }

        try
        {
            var allStores = ScanStores(log);
            var userStores = SelectForUser(allStores, userLogin);
            var profileEmails = CollectProfileEmails(userLogin, log);
            var state = LoadState(paths, log);

            var payload = BuildPayload(userLogin, userStores, state, profileEmails);

            var files = new Dictionary<string, object?>();
            if (state.GetValueOrDefault("files") is Dictionary<string, object?> oldFiles)
            {
                foreach (var (key, raw) in oldFiles)
                {
                    if (raw is not Dictionary<string, object?> row)
                    {
                        continue;
                    }

                    var seenAt = Math.Max(0, Text.ToLong(row.GetValueOrDefault("last_seen_at"), 0));
                    if (seenAt > 0 && now - seenAt > StateMaxAgeSeconds)
                    {
                        continue;
                    }

                    files[key.ToLowerInvariant()] = new Dictionary<string, object?>
                    {
                        ["size_bytes"] = Math.Max(0, Text.ToLong(row.GetValueOrDefault("size_bytes"), 0)),
                        ["last_seen_at"] = seenAt,
                    };
                }
            }

            foreach (var store in allStores)
            {
                var path = Text.Sanitize(store.GetValueOrDefault("path"));
                if (path.Length == 0)
                {
                    continue;
                }

                files[path.ToLowerInvariant()] = new Dictionary<string, object?>
                {
                    ["size_bytes"] = Math.Max(0, Text.ToLong(store.GetValueOrDefault("size_bytes"), 0)),
                    ["last_seen_at"] = now,
                };
            }

            if (persistState)
            {
                SaveState(paths, now, files, log);
            }
            lock (CacheGate)
            {
                _cachedUser = normalizedUser;
                _cachedAt = now;
                _cachedPayload = new Dictionary<string, object?>(payload);
            }

            return payload;
        }
        catch (Exception ex)
        {
            log.Warn($"Outlook collection failed: {ex.Message}");
            return Normalize(null);
        }
    }

    private static List<Dictionary<string, object?>> ScanStores(AgentLog log)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var stores = new List<Dictionary<string, object?>>();

        foreach (var userDir in EnumerateUserDirs())
        {
            var profileName = Path.GetFileName(userDir);
            foreach (var pattern in ProfilePatterns)
            {
                string[] matches;
                try
                {
                    var directory = Path.Combine(userDir, Path.GetDirectoryName(pattern) ?? string.Empty);
                    if (!Directory.Exists(directory))
                    {
                        continue;
                    }

                    matches = Directory.GetFiles(directory, Path.GetFileName(pattern), SearchOption.TopDirectoryOnly);
                }
                catch (Exception)
                {
                    continue;
                }

                foreach (var match in matches)
                {
                    var row = BuildStoreRow(match, seen, profileName);
                    if (row is not null)
                    {
                        stores.Add(row);
                    }
                }
            }
        }

        var roots = SearchRoots();
        log.Info(roots.Count > 0
            ? $"Outlook extra search roots: {string.Join("; ", roots)}"
            : "Outlook extra search roots are disabled");

        var extraErrors = 0;
        foreach (var root in roots)
        {
            if (!Directory.Exists(root))
            {
                continue;
            }

            var stack = new Stack<string>();
            stack.Push(root);
            while (stack.Count > 0)
            {
                var current = stack.Pop();
                try
                {
                    foreach (var entry in Directory.EnumerateFileSystemEntries(current))
                    {
                        var name = Path.GetFileName(entry);
                        FileAttributes attributes;
                        try
                        {
                            attributes = File.GetAttributes(entry);
                        }
                        catch (Exception)
                        {
                            extraErrors++;
                            continue;
                        }

                        if (attributes.HasFlag(FileAttributes.ReparsePoint))
                        {
                            continue;
                        }

                        if (attributes.HasFlag(FileAttributes.Directory))
                        {
                            if (ExtraRootSkipDirs.Contains(name))
                            {
                                continue;
                            }

                            stack.Push(entry);
                            continue;
                        }

                        var extension = Path.GetExtension(entry).ToLowerInvariant();
                        if (extension is not (".pst" or ".ost"))
                        {
                            continue;
                        }

                        var row = BuildStoreRow(entry, seen, string.Empty);
                        if (row is not null)
                        {
                            stores.Add(row);
                        }
                    }
                }
                catch (Exception)
                {
                    extraErrors++;
                }
            }
        }

        log.Info($"Outlook fallback scan summary: profile_paths={stores.Count} extra_roots={roots.Count} errors={extraErrors} total={stores.Count}");
        return stores;
    }

    private static IEnumerable<string> EnumerateUserDirs()
    {
        const string usersRoot = @"C:\Users";
        if (!Directory.Exists(usersRoot))
        {
            return Array.Empty<string>();
        }

        try
        {
            return Directory.EnumerateDirectories(usersRoot).ToList();
        }
        catch (Exception)
        {
            return Array.Empty<string>();
        }
    }

    private static Dictionary<string, object?>? BuildStoreRow(string path, HashSet<string> seen, string profileName)
    {
        try
        {
            var info = new FileInfo(path);
            if (!info.Exists)
            {
                return null;
            }

            var fullPath = info.FullName;
            if (!seen.Add(fullPath))
            {
                return null;
            }

            var type = info.Extension.ToLowerInvariant() switch
            {
                ".ost" => "ost",
                ".pst" => "pst",
                var other => other.TrimStart('.'),
            };

            return new Dictionary<string, object?>
            {
                ["path"] = fullPath,
                ["type"] = type,
                ["size_bytes"] = Math.Max(0, info.Length),
                ["last_modified_at"] = Math.Max(0, new DateTimeOffset(info.LastWriteTimeUtc).ToUnixTimeSeconds()),
                ["profile_name"] = profileName,
            };
        }
        catch (Exception)
        {
            return null;
        }
    }

    private static List<string> SearchRoots()
    {
        var raw = Environment.GetEnvironmentVariable("ITINV_OUTLOOK_SEARCH_ROOTS");
        var candidates = raw is null
            ? new List<string> { DefaultExtraRoot }
            : raw.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();

        var roots = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var candidate in candidates)
        {
            var expanded = Environment.ExpandEnvironmentVariables(candidate.Trim());
            if (expanded.Length == 0 || !Path.IsPathFullyQualified(expanded))
            {
                continue;
            }

            if (seen.Add(expanded))
            {
                roots.Add(expanded);
            }
        }

        return roots;
    }

    private static List<Dictionary<string, object?>> SelectForUser(List<Dictionary<string, object?>> stores, string userLogin)
    {
        if (stores.Count == 0)
        {
            return stores;
        }

        var login = HostCollector.NormalizeLogin(userLogin).ToLowerInvariant();
        if (login.Length == 0)
        {
            return stores;
        }

        var marker = $@"\users\{login}\";
        var selected = stores
            .Where(row => Text.Sanitize(row.GetValueOrDefault("path")).ToLowerInvariant().Contains(marker, StringComparison.Ordinal))
            .ToList();
        if (selected.Count > 0)
        {
            return selected;
        }

        selected = stores
            .Where(row => Text.Sanitize(row.GetValueOrDefault("profile_name")).Equals(login, StringComparison.OrdinalIgnoreCase))
            .ToList();
        return selected.Count > 0 ? selected : stores;
    }

    private static List<string> CollectProfileEmails(string userLogin, AgentLog log)
    {
        var sids = ResolveUserSids(userLogin);
        if (sids.Count == 0)
        {
            return new List<string>();
        }

        var relativePaths = new[]
        {
            @"Software\Microsoft\Office\16.0\Outlook\Profiles",
            @"Software\Microsoft\Windows NT\CurrentVersion\Windows Messaging Subsystem\Profiles",
        };

        foreach (var sid in sids)
        {
            var emails = new List<string>();
            foreach (var relativePath in relativePaths)
            {
                emails.AddRange(CollectEmailsFromTree($@"{sid}\{relativePath}"));
            }

            emails = Text.Dedupe(emails);
            if (emails.Count > 0)
            {
                log.Debug($"Outlook profile emails loaded: user={userLogin} sid={sid} count={emails.Count}");
                return emails;
            }
        }

        return new List<string>();
    }

    private static List<string> ResolveUserSids(string userLogin)
    {
        var login = HostCollector.NormalizeLogin(userLogin).ToLowerInvariant();
        if (login.Length == 0)
        {
            return new List<string>();
        }

        var matched = new List<string>();
        try
        {
            using var profileList = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList");
            if (profileList is not null)
            {
                foreach (var sid in profileList.GetSubKeyNames())
                {
                    if (!Regex.IsMatch(sid, @"^S-\d-\d+(?:-\d+)+$", RegexOptions.CultureInvariant))
                    {
                        continue;
                    }

                    using var sidKey = profileList.OpenSubKey(sid);
                    var raw = Text.Sanitize(sidKey?.GetValue("ProfileImagePath"));
                    if (raw.Length == 0)
                    {
                        continue;
                    }

                    var expanded = Environment.ExpandEnvironmentVariables(raw);
                    var profileName = Path.GetFileName(expanded.TrimEnd('\\')).ToLowerInvariant();
                    if (profileName == login)
                    {
                        matched.Add(sid);
                    }
                }
            }
        }
        catch (Exception)
        {
            // profile list unavailable
        }

        var loaded = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            using var users = Registry.Users;
            foreach (var name in users.GetSubKeyNames())
            {
                if (!name.EndsWith("_Classes", StringComparison.OrdinalIgnoreCase) &&
                    Regex.IsMatch(name, @"^S-\d-\d+(?:-\d+)+$", RegexOptions.CultureInvariant))
                {
                    loaded.Add(name);
                }
            }
        }
        catch (Exception)
        {
            // no loaded hives
        }

        var matchedLoaded = matched.Where(loaded.Contains).ToList();
        if (matchedLoaded.Count > 0)
        {
            return matchedLoaded.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        }

        if (matched.Count > 0)
        {
            return matched.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        }

        return loaded.Count == 1 ? loaded.ToList() : new List<string>();
    }

    private static List<string> CollectEmailsFromTree(string basePath)
    {
        var emails = new List<string>();
        var stack = new Stack<string>();
        stack.Push(basePath);

        while (stack.Count > 0)
        {
            var path = stack.Pop();
            try
            {
                using var key = Registry.Users.OpenSubKey(path);
                if (key is null)
                {
                    continue;
                }

                foreach (var valueName in key.GetValueNames())
                {
                    var raw = key.GetValue(valueName);
                    foreach (var text in DecodeRegistryValueTexts(raw))
                    {
                        foreach (Match match in EmailRegex().Matches(text))
                        {
                            var email = NormalizeEmail(match.Value);
                            if (email.Length > 0)
                            {
                                emails.Add(email);
                            }
                        }
                    }
                }

                foreach (var subKey in key.GetSubKeyNames())
                {
                    stack.Push($@"{path}\{subKey}");
                }
            }
            catch (Exception)
            {
                // skip this branch
            }
        }

        return Text.Dedupe(emails);
    }

    private static IEnumerable<string> DecodeRegistryValueTexts(object? value)
    {
        var texts = new List<string>();
        switch (value)
        {
            case string text:
                texts.Add(text);
                break;
            case string[] multi:
                texts.AddRange(multi);
                break;
            case byte[] bytes:
                foreach (var encoding in new[] { Encoding.Unicode, Encoding.BigEndianUnicode, Encoding.UTF8, Encoding.GetEncoding(1251), Encoding.GetEncoding(866), Encoding.ASCII })
                {
                    try
                    {
                        var decoded = encoding.GetString(bytes).Replace('\0', ' ').Trim();
                        if (decoded.Length > 0)
                        {
                            texts.Add(decoded);
                        }
                    }
                    catch (Exception)
                    {
                        // encoding unavailable
                    }
                }

                break;
            case null:
                break;
            default:
                texts.Add(value.ToString() ?? string.Empty);
                break;
        }

        return Text.Dedupe(texts.Select(item => item.Replace('\0', ' ')));
    }

    private static string NormalizeEmail(string? value)
    {
        var email = Text.Sanitize(value).ToLowerInvariant();
        while (email.EndsWith(".pst", StringComparison.Ordinal) || email.EndsWith(".ost", StringComparison.Ordinal))
        {
            email = email[..^4].TrimEnd('.');
        }

        return EmailRegex().IsMatch(email) && email.Contains('@') && !email.Contains(' ')
            ? email
            : string.Empty;
    }

    private static Dictionary<string, object?> BuildPayload(
        string userLogin,
        List<Dictionary<string, object?>> userStores,
        Dictionary<string, object?> previousState,
        List<string> profileEmails)
    {
        if (userStores.Count == 0)
        {
            return Normalize(null);
        }

        var stateFiles = previousState.GetValueOrDefault("files") as Dictionary<string, object?> ?? new Dictionary<string, object?>();
        var (activeStores, activeCandidate, confidence) = ChooseActiveStores(userStores, stateFiles, userLogin, profileEmails);
        var activePaths = activeStores
            .Select(row => Text.Sanitize(row.GetValueOrDefault("path")).ToLowerInvariant())
            .Where(path => path.Length > 0)
            .ToHashSet(StringComparer.Ordinal);

        var archives = userStores
            .Where(row =>
            {
                var path = Text.Sanitize(row.GetValueOrDefault("path")).ToLowerInvariant();
                return path.Length > 0 && !activePaths.Contains(path);
            })
            .ToList();

        string largestPath = string.Empty;
        long largestSize = 0;
        long totalSize = 0;
        foreach (var row in userStores)
        {
            var size = Math.Max(0, Text.ToLong(row.GetValueOrDefault("size_bytes"), 0));
            totalSize += size;
            if (size > largestSize)
            {
                largestSize = size;
                largestPath = Text.Sanitize(row.GetValueOrDefault("path"));
            }
        }

        var payload = new Dictionary<string, object?>
        {
            ["collected_at"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            ["source"] = "system_scan",
            ["confidence"] = confidence,
            ["threshold_warning_bytes"] = WarningThresholdBytes,
            ["threshold_critical_bytes"] = CriticalThresholdBytes,
            ["active_store"] = activeStores.FirstOrDefault(),
            ["active_stores"] = activeStores,
            ["active_candidate"] = activeCandidate,
            ["archives"] = archives,
            ["largest_file_path"] = largestPath,
            ["largest_file_size_bytes"] = largestSize,
            ["total_outlook_size_bytes"] = totalSize,
            ["collector"] = "scan_profile_email_first",
            ["user"] = userLogin,
        };

        return Normalize(payload);
    }

    private static (List<Dictionary<string, object?>> Active, Dictionary<string, object?>? Candidate, string Confidence)
        ChooseActiveStores(
            List<Dictionary<string, object?>> stores,
            Dictionary<string, object?> stateFiles,
            string userLogin,
            List<string> profileEmails)
    {
        if (stores.Count == 0)
        {
            return (new List<Dictionary<string, object?>>(), null, "low");
        }

        var tokens = BuildMatchTokens(userLogin, profileEmails);
        var nonArchive = stores.Where(row => !IsForcedArchive(Text.Sanitize(row.GetValueOrDefault("path")))).ToList();
        if (nonArchive.Count == 0)
        {
            return (new List<Dictionary<string, object?>>(), null, "low");
        }

        var matched = new List<(int Priority, long Delta, long Modified, Dictionary<string, object?> Row)>();
        foreach (var row in nonArchive)
        {
            var path = Text.Sanitize(row.GetValueOrDefault("path"));
            if (path.Length == 0)
            {
                continue;
            }

            var priority = MatchPriority(path, tokens);
            if (priority < 2)
            {
                continue;
            }

            var (previousSize, delta) = CompareToState(stateFiles, path, row);
            matched.Add((priority, delta, Math.Max(0, Text.ToLong(row.GetValueOrDefault("last_modified_at"), 0)), row));
        }

        if (matched.Count > 0)
        {
            var active = matched
                .OrderByDescending(item => item.Priority)
                .ThenByDescending(item => item.Delta)
                .ThenByDescending(item => item.Modified)
                .Take(10)
                .Select(item => item.Row)
                .ToList();
            return (active, null, "medium");
        }

        var changed = new List<(int Score, long Delta, long Modified, Dictionary<string, object?> Row)>();
        foreach (var row in nonArchive)
        {
            var path = Text.Sanitize(row.GetValueOrDefault("path"));
            if (path.Length == 0)
            {
                continue;
            }

            var (previousSize, delta) = CompareToState(stateFiles, path, row);
            if (previousSize < 0 || delta <= 0)
            {
                continue;
            }

            changed.Add((
                NameScore(path, userLogin, profileEmails, tokens),
                delta,
                Math.Max(0, Text.ToLong(row.GetValueOrDefault("last_modified_at"), 0)),
                row));
        }

        if (changed.Count > 0)
        {
            var active = changed
                .OrderByDescending(item => item.Score)
                .ThenByDescending(item => item.Delta)
                .ThenByDescending(item => item.Modified)
                .Take(10)
                .Select(item => item.Row)
                .ToList();
            return (active, null, "medium");
        }

        var candidate = nonArchive
            .OrderByDescending(row => NameScore(Text.Sanitize(row.GetValueOrDefault("path")), userLogin, profileEmails, tokens))
            .ThenByDescending(row => Text.ToLong(row.GetValueOrDefault("last_modified_at"), 0))
            .ThenByDescending(row => Text.ToLong(row.GetValueOrDefault("size_bytes"), 0))
            .First();

        return (new List<Dictionary<string, object?>>(), candidate, "low");
    }

    private static (long PreviousSize, long Delta) CompareToState(
        Dictionary<string, object?> stateFiles,
        string path,
        Dictionary<string, object?> row)
    {
        var key = path.ToLowerInvariant();
        if (stateFiles.GetValueOrDefault(key) is not Dictionary<string, object?> previous)
        {
            return (-1, 0);
        }

        var previousSize = Text.ToLong(previous.GetValueOrDefault("size_bytes"), -1);
        var currentSize = Math.Max(0, Text.ToLong(row.GetValueOrDefault("size_bytes"), 0));
        return previousSize < 0 ? (-1, 0) : (previousSize, Math.Abs(currentSize - previousSize));
    }

    private sealed record MatchTokens(HashSet<string> EmailFull, HashSet<string> EmailLocal, HashSet<string> Login);

    private static MatchTokens BuildMatchTokens(string userLogin, List<string> profileEmails)
    {
        var emailFull = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var emailLocal = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var logins = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var login = HostCollector.NormalizeLogin(userLogin).ToLowerInvariant();
        if (login.Length > 0)
        {
            logins.Add(login);
            logins.Add(login.Replace('_', '.'));
            logins.Add(login.Replace('.', '_'));
        }

        foreach (var raw in profileEmails)
        {
            var email = NormalizeEmail(raw);
            if (email.Length == 0)
            {
                continue;
            }

            emailFull.Add(email);
            var local = email.Split('@')[0];
            if (local.Length > 0)
            {
                emailLocal.Add(local);
                emailLocal.Add(local.Replace('_', '.'));
                emailLocal.Add(local.Replace('.', '_'));
            }
        }

        return new MatchTokens(emailFull, emailLocal, logins);
    }

    private static int MatchPriority(string path, MatchTokens tokens)
    {
        var stem = StoreStem(path);
        if (stem.Length == 0)
        {
            return 0;
        }

        if (tokens.EmailFull.Contains(stem))
        {
            return 3;
        }

        if (tokens.EmailLocal.Contains(stem))
        {
            return 2;
        }

        return tokens.Login.Contains(stem) ? 1 : 0;
    }

    private static int NameScore(string path, string userLogin, List<string> profileEmails, MatchTokens tokens)
    {
        if (IsForcedArchive(path))
        {
            return 0;
        }

        return MatchPriority(path, tokens) switch
        {
            >= 3 => 4,
            2 => 3,
            1 => 2,
            _ => 1,
        };
    }

    private static string StoreStem(string path)
    {
        try
        {
            return Path.GetFileNameWithoutExtension(Text.Sanitize(path)).ToLowerInvariant();
        }
        catch (Exception)
        {
            return Text.Sanitize(path).ToLowerInvariant();
        }
    }

    private static bool IsForcedArchive(string path)
    {
        var stem = StoreStem(path);
        return stem.Length > 0 && ArchiveNameRegex().IsMatch(stem);
    }

    private static Dictionary<string, object?> Normalize(Dictionary<string, object?>? raw)
    {
        var result = new Dictionary<string, object?>
        {
            ["collected_at"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            ["source"] = "none",
            ["confidence"] = "low",
            ["status"] = "unknown",
            ["threshold_warning_bytes"] = WarningThresholdBytes,
            ["threshold_critical_bytes"] = CriticalThresholdBytes,
            ["active_store"] = null,
            ["active_stores"] = new List<Dictionary<string, object?>>(),
            ["active_candidate"] = null,
            ["archives"] = new List<Dictionary<string, object?>>(),
            ["largest_file_path"] = string.Empty,
            ["largest_file_size_bytes"] = 0,
            ["total_outlook_size_bytes"] = 0,
        };

        if (raw is null)
        {
            return result;
        }

        var warning = Math.Max(1, Text.ToLong(raw.GetValueOrDefault("threshold_warning_bytes"), WarningThresholdBytes));
        var critical = Math.Max(warning, Text.ToLong(raw.GetValueOrDefault("threshold_critical_bytes"), CriticalThresholdBytes));

        var source = Text.Sanitize(raw.GetValueOrDefault("source")).ToLowerInvariant();
        if (source is not ("system_scan" or "none"))
        {
            source = "none";
        }

        var confidence = Text.Sanitize(raw.GetValueOrDefault("confidence")).ToLowerInvariant();
        if (confidence is not ("high" or "medium" or "low"))
        {
            confidence = "low";
        }

        var activeStore = NormalizeStore(raw.GetValueOrDefault("active_store"));
        var activeStores = new List<Dictionary<string, object?>>();
        if (raw.GetValueOrDefault("active_stores") is List<Dictionary<string, object?>> rows)
        {
            foreach (var row in rows)
            {
                var normalized = NormalizeStore(row);
                if (normalized is not null)
                {
                    activeStores.Add(normalized);
                }
            }
        }

        if (activeStore is not null)
        {
            activeStores.Insert(0, activeStore);
        }

        var seenPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        activeStores = activeStores
            .Where(row =>
            {
                var path = Text.Sanitize(row.GetValueOrDefault("path")).ToLowerInvariant();
                return path.Length > 0 && seenPaths.Add(path);
            })
            .ToList();

        activeStore = activeStores.FirstOrDefault();

        var archives = new List<Dictionary<string, object?>>();
        if (raw.GetValueOrDefault("archives") is List<Dictionary<string, object?>> archiveRows)
        {
            foreach (var row in archiveRows)
            {
                var normalized = NormalizeStore(row);
                if (normalized is not null)
                {
                    archives.Add(normalized);
                }
            }
        }

        var activeSize = activeStores
            .Select(row => Math.Max(0, Text.ToLong(row.GetValueOrDefault("size_bytes"), 0)))
            .DefaultIfEmpty(0)
            .Max();

        var status = "unknown";
        if (activeSize > 0 && confidence is "high" or "medium")
        {
            status = activeSize >= critical ? "critical" : activeSize >= warning ? "warning" : "ok";
        }

        result["collected_at"] = Math.Max(0, Text.ToLong(raw.GetValueOrDefault("collected_at"), DateTimeOffset.UtcNow.ToUnixTimeSeconds()));
        result["source"] = source;
        result["confidence"] = confidence;
        result["status"] = status;
        result["threshold_warning_bytes"] = warning;
        result["threshold_critical_bytes"] = critical;
        result["active_store"] = activeStore;
        result["active_stores"] = activeStores;
        result["active_candidate"] = NormalizeStore(raw.GetValueOrDefault("active_candidate"));
        result["archives"] = archives;
        result["largest_file_path"] = Text.Sanitize(raw.GetValueOrDefault("largest_file_path"));
        result["largest_file_size_bytes"] = Math.Max(0, Text.ToLong(raw.GetValueOrDefault("largest_file_size_bytes"), 0));
        result["total_outlook_size_bytes"] = Math.Max(0, Text.ToLong(raw.GetValueOrDefault("total_outlook_size_bytes"), 0));
        return result;
    }

    private static Dictionary<string, object?>? NormalizeStore(object? value)
    {
        if (value is not Dictionary<string, object?> row)
        {
            return null;
        }

        var path = Text.Sanitize(row.GetValueOrDefault("path"));
        if (path.Length == 0)
        {
            return null;
        }

        var type = Text.Sanitize(row.GetValueOrDefault("type")).ToLowerInvariant();
        if (type.Length == 0)
        {
            type = Path.GetExtension(path).ToLowerInvariant() switch
            {
                ".ost" => "ost",
                ".pst" => "pst",
                var other => other.TrimStart('.'),
            };
        }

        return new Dictionary<string, object?>
        {
            ["path"] = path,
            ["type"] = type,
            ["size_bytes"] = Math.Max(0, Text.ToLong(row.GetValueOrDefault("size_bytes"), 0)),
            ["last_modified_at"] = Math.Max(0, Text.ToLong(row.GetValueOrDefault("last_modified_at"), 0)),
        };
    }

    private static Dictionary<string, object?> LoadState(AgentPaths paths, AgentLog log)
    {
        try
        {
            if (!File.Exists(paths.OutboundStateFile))
            {
                return new Dictionary<string, object?>();
            }

            var node = JsonNode.Parse(File.ReadAllText(paths.OutboundStateFile));
            return node is JsonObject obj ? ToDictionary(obj) : new Dictionary<string, object?>();
        }
        catch (Exception ex)
        {
            log.Warn($"Outlook scan state read failed ({paths.OutboundStateFile}): {ex.Message}");
            return new Dictionary<string, object?>();
        }
    }

    private static void SaveState(AgentPaths paths, long now, Dictionary<string, object?> files, AgentLog log)
    {
        try
        {
            var state = new Dictionary<string, object?>
            {
                ["updated_at"] = now,
                ["files"] = files,
            };
            AtomicFile.WriteAllText(paths.OutboundStateFile, JsonSerializer.Serialize(state));
        }
        catch (Exception ex)
        {
            log.Warn($"Failed to save Outlook scan state ({paths.OutboundStateFile}): {ex.Message}");
        }
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
}
