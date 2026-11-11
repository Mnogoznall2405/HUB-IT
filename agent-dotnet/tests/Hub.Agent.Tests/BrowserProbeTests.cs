using System.Text.Json;
using Hub.Agent.Core.BrowserProbe;
using Hub.Agent.Core.Diagnostics;
using Hub.Agent.Core.Support;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Hub.Agent.Tests;

public sealed class BrowserProbeTests
{
    [Theory]
    [InlineData("https://hubit.zsgp.ru/tasks", "Задачи", "hubit.zsgp.ru", "work")]
    [InlineData("https://www.youtube.com/watch?v=1", "Видео", "youtube.com", "entertainment")]
    [InlineData("https://example.com/page", "Задачи", "example.com", "other")]
    [InlineData("https://example.com/page", "Jira board", "example.com", "work")]
    public void ClassificationMatchesThePythonProbe(string url, string title, string domain, string category)
    {
        Assert.Equal((domain, category), BrowserClassify.Classify(url, title));
    }

    [Theory]
    [InlineData("chrome://newtab", "Новая вкладка", true)]
    [InlineData("about:blank", "", true)]
    [InlineData("https://hubit.zsgp.ru", "HUB-IT", false)]
    [InlineData("edge://settings", "Settings", true)]
    public void NoiseFilterDropsBrowserChrome(string url, string title, bool noise)
    {
        Assert.Equal(noise, BrowserClassify.IsNoise(url, title));
    }

    [Fact]
    public void HistoryDeltaReturnsVisitsAndAdvancesCursor()
    {
        var root = Path.Combine(AppContext.BaseDirectory, "browser-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        var history = Path.Combine(root, "History");
        CreateHistoryDb(history);

        try
        {
            var profile = new BrowserProfile("chrome", "Default", history, "ivan");
            var batch = BrowserHistory.ReadVisitsSince(profile, 0, 400, Path.Combine(root, "work"));

            Assert.Equal(2, batch.Cursor);
            Assert.False(batch.NoiseOnly);
            Assert.Single(batch.Rows);
            var row = batch.Rows[0];
            Assert.Equal("https://hubit.zsgp.ru/tasks", row["url"]);
            Assert.Equal("work", row["category"]);
            Assert.Equal("ivan|chrome|Default", profile.CursorKey);
            Assert.NotNull(row["visited_at"]);
        }
        finally
        {
            Cleanup(root);
        }
    }

    [Fact]
    public void NoiseOnlyBatchStillAdvancesTheCursor()
    {
        var root = Path.Combine(AppContext.BaseDirectory, "browser-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        var history = Path.Combine(root, "History");
        using (var connection = new SqliteConnection($"Data Source={history}"))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = """
                CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER);
                CREATE TABLE visits (id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER);
                INSERT INTO urls (id, url, title, visit_count) VALUES (1, 'chrome://newtab', 'Новая вкладка', 1);
                INSERT INTO visits (id, url, visit_time) VALUES (1, 1, 13300000000000000);
                """;
            command.ExecuteNonQuery();
        }

        try
        {
            var profile = new BrowserProfile("chrome", "Default", history, string.Empty);
            var batch = BrowserHistory.ReadVisitsSince(profile, 0, 400, Path.Combine(root, "work"));

            Assert.True(batch.NoiseOnly);
            Assert.Empty(batch.Rows);
            Assert.Equal(1, batch.Cursor);
        }
        finally
        {
            Cleanup(root);
        }
    }

    [Fact]
    public void SyncQueueMergesVisitsIntoSinglePendingFile()
    {
        var root = Path.Combine(AppContext.BaseDirectory, "browser-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        using var log = AgentLog.Create(Path.Combine(root, "test.log"), mirrorToConsole: false);

        try
        {
            var sync = new BrowserProbeSync(root, "http://127.0.0.1:9/api/v1/inventory", "key", 30, log);
            sync.Enqueue(new Dictionary<string, object?>
            {
                ["computer_name"] = "PC",
                ["windows_user"] = "ivan",
                ["visits"] = new List<Dictionary<string, object?>> { new() { ["url"] = "https://example.com" } },
                ["focus_events"] = new List<Dictionary<string, object?>>(),
                ["screenshots"] = new List<Dictionary<string, object?>>(),
            });

            var path = Path.Combine(root, "pending_upload.json");
            Assert.True(File.Exists(path));
            using var document = JsonDocument.Parse(File.ReadAllText(path));
            Assert.Equal("PC", document.RootElement.GetProperty("computer_name").GetString());
            Assert.Single(document.RootElement.GetProperty("visits").EnumerateArray());
        }
        finally
        {
            Cleanup(root);
        }
    }

    [Fact]
    public void HistoryServiceBootstrapsThenUploadsOnlyNewVisits()
    {
        var root = Path.Combine(AppContext.BaseDirectory, "browser-tests", Guid.NewGuid().ToString("N"));
        var users = Path.Combine(root, "Users");
        var profileDir = Path.Combine(users, "ivan", "AppData", "Local", "Google", "Chrome", "User Data", "Default");
        Directory.CreateDirectory(profileDir);
        var history = Path.Combine(profileDir, "History");
        CreateHistoryDb(history);

        var paths = new AgentPaths(Path.Combine(root, "data")).EnsureWritable();
        using var log = AgentLog.Create(Path.Combine(root, "test.log"), mirrorToConsole: false);
        var service = new BrowserHistoryService(paths, log, users, enabledOverride: true);

        try
        {
            // First cycle only remembers the current max visit id: no history dump.
            Assert.Equal(0, service.CollectOnce());

            using (var connection = new SqliteConnection($"Data Source={history}"))
            {
                connection.Open();
                using var command = connection.CreateCommand();
                command.CommandText = """
                    INSERT INTO urls (id, url, title, visit_count) VALUES (3, 'https://example.com/new', 'New page', 1);
                    INSERT INTO visits (id, url, visit_time) VALUES (3, 3, 13300000002000000);
                    """;
                command.ExecuteNonQuery();
            }

            Assert.Equal(1, service.CollectOnce());

            var pending = Path.Combine(paths.AgentRoot, "BrowserHistory", "pending_upload.json");
            Assert.True(File.Exists(pending));
            using var document = JsonDocument.Parse(File.ReadAllText(pending));
            var visits = document.RootElement.GetProperty("visits").EnumerateArray().ToList();
            Assert.Single(visits);
            Assert.Equal("https://example.com/new", visits[0].GetProperty("url").GetString());
            Assert.Equal("ivan@Default", visits[0].GetProperty("profile").GetString());
        }
        finally
        {
            Cleanup(root);
        }
    }

    private static void Cleanup(string root)
    {
        SqliteConnection.ClearAllPools();
        for (var attempt = 0; attempt < 5; attempt++)
        {
            try
            {
                Directory.Delete(root, recursive: true);
                return;
            }
            catch (IOException)
            {
                Thread.Sleep(100);
            }
        }
    }

    private static void CreateHistoryDb(string path)
    {
        using var connection = new SqliteConnection($"Data Source={path}");
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER);
            CREATE TABLE visits (id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER);
            INSERT INTO urls (id, url, title, visit_count) VALUES (1, 'chrome://newtab', 'Новая вкладка', 1);
            INSERT INTO urls (id, url, title, visit_count) VALUES (2, 'https://hubit.zsgp.ru/tasks', 'Задачи', 5);
            INSERT INTO visits (id, url, visit_time) VALUES (1, 1, 13300000000000000);
            INSERT INTO visits (id, url, visit_time) VALUES (2, 2, 13300000001000000);
            """;
        command.ExecuteNonQuery();
    }
}

