using System.Text.Json;
using Hub.Agent.Core.Configuration;
using Hub.Agent.Core.Diagnostics;
using Hub.Agent.Core.FsEgress;
using Hub.Agent.Core.Support;
using Xunit;

namespace Hub.Agent.Tests;

public sealed class FsEgressTests
{
    [Theory]
    [InlineData(@"C:\Users\ivan\Documents\file.pdf", false)]
    [InlineData(@"C:\Users\ivan\AppData\Local\Temp\x.tmp", true)]
    [InlineData(@"C:\Users\ivan\Documents\~$report.docx", true)]
    [InlineData(@"C:\Users\ivan\Documents\report.docx", false)]
    [InlineData(@"E:\backup\dump.7z", false)]
    [InlineData("", true)]
    public void IgnoreRulesMatchThePythonSidecar(string path, bool ignored)
    {
        Assert.Equal(ignored, FsEgressRoots.ShouldIgnorePath(path));
    }

    [Theory]
    [InlineData(@"C:\Users\ivan\Desktop\a.txt", "ivan")]
    [InlineData(@"C:\Users\Public\Desktop\a.txt", "")]
    [InlineData(@"D:\data\a.txt", "")]
    public void ProfileUserIsExtractedFromThePath(string path, string expected)
    {
        Assert.Equal(expected, FsEgressEvent.UserFromProfilePath(path));
    }

    [Fact]
    public void EventContainsSizeAndHashForSmallFiles()
    {
        var root = Path.Combine(Path.GetTempPath(), "hub-agent-fs", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        var file = Path.Combine(root, "note.txt");
        File.WriteAllText(file, "hello");

        try
        {
            var evt = FsEgressEvent.Build("usb", file, computeHash: true,
                details: new Dictionary<string, object?> { ["kind"] = "fs_watch" });

            Assert.Equal("usb", evt["channel"]);
            Assert.Equal("note.txt", evt["file_name"]);
            Assert.Equal(5L, Convert.ToInt64(evt["size"]));
            Assert.Equal(64, ((string)evt["sha256"]!).Length);
            Assert.Equal("fs_watch", ((Dictionary<string, object?>)evt["details"]!)["kind"]);
            Assert.Matches("^[0-9a-f]{32}$", (string)evt["event_id"]!);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task WatcherSpoolsAFileCreatedInAUSBLikeRoot()
    {
        var root = Path.Combine(AppContext.BaseDirectory, "fs-egress-tests", Guid.NewGuid().ToString("N"));
        var spool = Path.Combine(root, "spool");
        var watched = Path.Combine(root, "usb");
        Directory.CreateDirectory(watched);
        var paths = new AgentPaths(Path.Combine(root, "data")).EnsureWritable();
        using var log = AgentLog.Create(Path.Combine(root, "test.log"), mirrorToConsole: false);

        var service = new FsEgressService(
            new AgentConfig { ApiKey = "test" },
            paths,
            log,
            extraRoots: new[] { watched },
            spoolRootOverride: spool);

        try
        {
            service.Start();
            await Task.Delay(500);
            var file = Path.Combine(watched, "report.txt");
            await File.WriteAllTextAsync(file, "payload");

            string? pending = null;
            for (var attempt = 0; attempt < 40 && pending is null; attempt++)
            {
                await Task.Delay(250);
                var pendingDir = Path.Combine(spool, "pending");
                if (Directory.Exists(pendingDir))
                {
                    pending = Directory.EnumerateFiles(pendingDir, "*.json").FirstOrDefault();
                }
            }

            Assert.NotNull(pending);
            using var document = JsonDocument.Parse(await File.ReadAllTextAsync(pending!));
            var value = document.RootElement;
            Assert.Equal("usb", value.GetProperty("channel").GetString());
            Assert.Equal("report.txt", value.GetProperty("file_name").GetString());
            Assert.Equal(7, value.GetProperty("size").GetInt64());
            Assert.Equal("fs_watch", value.GetProperty("details").GetProperty("kind").GetString());
        }
        finally
        {
            service.Stop();
            try
            {
                Directory.Delete(root, recursive: true);
            }
            catch (Exception)
            {
                // FileSystemWatcher may still hold the directory briefly
            }
        }
    }
}
