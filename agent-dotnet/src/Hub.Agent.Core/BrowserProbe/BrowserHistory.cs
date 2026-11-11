using Microsoft.Data.Sqlite;
using Hub.Agent.Core.Support;

namespace Hub.Agent.Core.BrowserProbe;

public sealed record BrowserProfile(string Browser, string Profile, string HistoryPath, string WindowsUser)
{
    public string CursorKey => WindowsUser.Length > 0
        ? $"{WindowsUser}|{Browser}|{Profile}"
        : $"{Browser}|{Profile}";
}

/// <summary>
/// Chromium history discovery and delta reads (parity with browser_probe/history.py).
/// The live History DB is copied together with its WAL/SHM sidecars before reading.
/// </summary>
public static class BrowserHistory
{
    private static readonly (string Browser, string RelativePath)[] Specs =
    {
        ("chrome", @"Google\Chrome\User Data"),
        ("edge", @"Microsoft\Edge\User Data"),
        ("yandex", @"Yandex\YandexBrowser\User Data"),
    };

    private static readonly HashSet<string> SkipProfiles = new(StringComparer.OrdinalIgnoreCase)
    {
        "all users", "default", "default user", "public", "defaultapppool",
    };

    private static readonly DateTime ChromiumEpoch = new(1601, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    public static List<BrowserProfile> DiscoverAllUsers(string? usersRoot = null)
    {
        var root = usersRoot ?? Path.Combine(Environment.GetEnvironmentVariable("SystemDrive") ?? "C:", "Users");
        var found = new List<BrowserProfile>();
        if (!Directory.Exists(root))
        {
            return found;
        }

        IEnumerable<string> users;
        try
        {
            users = Directory.EnumerateDirectories(root).OrderBy(path => path, StringComparer.OrdinalIgnoreCase);
        }
        catch (Exception)
        {
            return found;
        }

        foreach (var userDir in users)
        {
            var name = Path.GetFileName(userDir).Trim();
            if (name.Length == 0 || SkipProfiles.Contains(name) || name.StartsWith('.'))
            {
                continue;
            }

            var localAppData = Path.Combine(userDir, "AppData", "Local");
            if (!Directory.Exists(localAppData))
            {
                continue;
            }

            found.AddRange(DiscoverProfiles(localAppData, name));
        }

        return found;
    }

    public static List<BrowserProfile> DiscoverProfiles(string localAppData, string windowsUser = "")
    {
        var found = new List<BrowserProfile>();
        foreach (var (browser, relative) in Specs)
        {
            var baseDir = Path.Combine(localAppData, relative);
            if (!Directory.Exists(baseDir))
            {
                continue;
            }

            IEnumerable<string> children;
            try
            {
                children = Directory.EnumerateDirectories(baseDir).OrderBy(path => path, StringComparer.OrdinalIgnoreCase);
            }
            catch (Exception)
            {
                continue;
            }

            foreach (var child in children)
            {
                var profileName = Path.GetFileName(child);
                if (profileName != "Default" && !profileName.StartsWith("Profile", StringComparison.Ordinal))
                {
                    continue;
                }

                var history = Path.Combine(child, "History");
                if (File.Exists(history))
                {
                    found.Add(new BrowserProfile(browser, profileName, history, windowsUser));
                }
            }
        }

        return found;
    }

    public static long LatestVisitId(BrowserProfile profile, string workDir)
    {
        using var snapshot = OpenSnapshot(profile, workDir);
        if (snapshot is null)
        {
            return 0;
        }

        try
        {
            using var command = snapshot.Connection.CreateCommand();
            command.CommandText = "SELECT COALESCE(MAX(id), 0) FROM visits";
            var result = command.ExecuteScalar();
            return result is null or DBNull ? 0 : Convert.ToInt64(result);
        }
        catch (Exception)
        {
            return 0;
        }
    }

    public sealed record VisitBatch(
        List<Dictionary<string, object?>> Rows,
        long Cursor,
        bool NoiseOnly);

    public static VisitBatch ReadVisitsSince(BrowserProfile profile, long sinceVisitId, int limit, string workDir)
    {
        using var snapshot = OpenSnapshot(profile, workDir);
        if (snapshot is null)
        {
            return new VisitBatch(new List<Dictionary<string, object?>>(), sinceVisitId, false);
        }

        var rows = new List<Dictionary<string, object?>>();
        var maxSeen = sinceVisitId;

        try
        {
            using var command = snapshot.Connection.CreateCommand();
            command.CommandText = """
                SELECT v.id AS visit_id, v.visit_time AS visit_time, u.url AS url,
                       u.title AS title, u.visit_count AS visit_count
                FROM visits v
                JOIN urls u ON u.id = v.url
                WHERE v.id > $since
                ORDER BY v.id ASC
                LIMIT $limit
                """;
            command.Parameters.AddWithValue("$since", sinceVisitId);
            command.Parameters.AddWithValue("$limit", Math.Clamp(limit, 1, 5000));

            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                var visitId = reader.GetInt64(0);
                maxSeen = Math.Max(visitId, maxSeen);
                var url = reader.IsDBNull(2) ? string.Empty : reader.GetString(2);
                var title = reader.IsDBNull(3) ? string.Empty : reader.GetString(3);
                if (title.Length > 500)
                {
                    title = title[..500];
                }

                if (BrowserClassify.IsNoise(url, title))
                {
                    continue;
                }

                var (domain, category) = BrowserClassify.Classify(url, title);
                rows.Add(new Dictionary<string, object?>
                {
                    ["visit_id"] = visitId,
                    ["browser"] = profile.Browser,
                    ["profile"] = profile.Profile,
                    ["url"] = url,
                    ["title"] = title,
                    ["domain"] = domain,
                    ["category"] = category,
                    ["visit_count"] = reader.IsDBNull(4) ? 0 : reader.GetInt64(4),
                    ["visited_at"] = ChromiumTimeToIso(reader.IsDBNull(1) ? 0 : reader.GetInt64(1)),
                });
            }
        }
        catch (Exception)
        {
            return new VisitBatch(new List<Dictionary<string, object?>>(), sinceVisitId, false);
        }

        if (maxSeen > sinceVisitId && rows.Count == 0)
        {
            return new VisitBatch(new List<Dictionary<string, object?>>(), maxSeen, true);
        }

        return new VisitBatch(rows, maxSeen, false);
    }

    public static string? ChromiumTimeToIso(long microseconds)
    {
        if (microseconds <= 0)
        {
            return null;
        }

        try
        {
            var utc = ChromiumEpoch.AddTicks(microseconds * 10);
            return utc.Microsecond == 0
                ? utc.ToString("yyyy-MM-ddTHH:mm:ss'Z'")
                : utc.ToString("yyyy-MM-ddTHH:mm:ss.ffffff'Z'");
        }
        catch (ArgumentOutOfRangeException)
        {
            return null;
        }
    }

    private sealed record Snapshot(SqliteConnection Connection, string Directory) : IDisposable
    {
        public void Dispose()
        {
            try
            {
                Connection.Close();
                SqliteConnection.ClearPool(Connection);
                Connection.Dispose();
            }
            catch (Exception)
            {
                // ignore
            }

            try
            {
                if (System.IO.Directory.Exists(Directory))
                {
                    System.IO.Directory.Delete(Directory, recursive: true);
                }
            }
            catch (Exception)
            {
                // temp cleanup is best effort
            }
        }
    }

    private static Snapshot? OpenSnapshot(BrowserProfile profile, string workDir)
    {
        try
        {
            var root = Path.Combine(workDir, "hub_it_browser_hist");
            System.IO.Directory.CreateDirectory(root);
            var directory = Path.Combine(root, Guid.NewGuid().ToString("N"));
            System.IO.Directory.CreateDirectory(directory);

            var destination = Path.Combine(directory, "History");
            File.Copy(profile.HistoryPath, destination, overwrite: true);
            foreach (var suffix in new[] { "-wal", "-shm" })
            {
                var side = profile.HistoryPath + suffix;
                if (File.Exists(side))
                {
                    try
                    {
                        File.Copy(side, destination + suffix, overwrite: true);
                    }
                    catch (Exception)
                    {
                        // sidecar is optional
                    }
                }
            }

            var connection = new SqliteConnection($"Data Source={destination};Mode=ReadOnly");
            connection.Open();
            return new Snapshot(connection, directory);
        }
        catch (Exception)
        {
            return null;
        }
    }
}
