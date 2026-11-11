using System.Text.Json.Nodes;
using Hub.Agent.Core.Diagnostics;
using Hub.Agent.Core.Spool;
using Hub.Agent.Core.Support;
using Hub.Agent.Core.Transport;
using Xunit;

namespace Hub.Agent.Tests;

public sealed class SpoolAndTransportTests : IDisposable
{
    private readonly string _root;
    private readonly AgentPaths _paths;
    private readonly AgentLog _log;

    public SpoolAndTransportTests()
    {
        _root = Path.Combine(Path.GetTempPath(), "hub-agent-tests", Guid.NewGuid().ToString("N"));
        _paths = new AgentPaths(_root).EnsureWritable();
        _log = AgentLog.Create(Path.Combine(_root, "test.log"), mirrorToConsole: false);
    }

    [Fact]
    public void EnqueueWritesPythonCompatibleItemAndFileName()
    {
        var spool = new InventorySpool(_paths, _log);
        var payload = new JsonObject { ["hostname"] = "test-host", ["timestamp"] = 123 };

        var path = spool.Enqueue(payload);
        var fileName = Path.GetFileName(path);

        Assert.Matches(@"^\d{10}_[0-9a-f]{32}\.json$", fileName);

        var item = spool.Read(path);
        Assert.NotNull(item);
        Assert.Equal("test-host", item!["payload"]!["hostname"]!.GetValue<string>());
        Assert.Equal(0L, item["attempts"]!.GetValue<long>());
        Assert.Equal(0, item["next_attempt_at"]!.GetValue<long>());
        Assert.Equal(1, spool.PendingDepth());
    }

    [Fact]
    public void CorruptItemGoesToDeadLetter()
    {
        var spool = new InventorySpool(_paths, _log);
        var path = Path.Combine(_paths.QueuePendingDir, "0000000001_broken.json");
        File.WriteAllText(path, "not json");

        var schedule = spool.Prune(new Hub.Agent.Core.Configuration.AgentConfig());

        Assert.Empty(schedule);
        Assert.Equal(0, spool.PendingDepth());
        Assert.Equal(1, spool.DeadDepth());
    }

    [Fact]
    public void AckRequiresSuccessTrue()
    {
        Assert.True(InventoryClient.IsValidAck("""{"success": true, "queued": true}"""));
        Assert.False(InventoryClient.IsValidAck("""{"success": false}"""));
        Assert.False(InventoryClient.IsValidAck("""{"queued": true}"""));
        Assert.False(InventoryClient.IsValidAck("<html>proxy page</html>"));
        Assert.False(InventoryClient.IsValidAck(""));
    }

    [Fact]
    public void HealthUrlKeepsOnlyTheOrigin()
    {
        Assert.Equal(
            "https://hubit.zsgp.ru/health",
            InventoryClient.BuildHealthUrl("https://hubit.zsgp.ru/api/v1/inventory"));
    }

    [Fact]
    public void BackoffGrowsAndStaysBounded()
    {
        for (var attempt = 1; attempt <= 30; attempt++)
        {
            var delay = InventorySpool.BackoffSeconds(attempt);
            Assert.InRange(delay, 5, 4500);
        }

        Assert.True(InventorySpool.BackoffSeconds(5) > InventorySpool.BackoffSeconds(1));
    }

    public void Dispose()
    {
        _log.Dispose();
        try
        {
            Directory.Delete(_root, recursive: true);
        }
        catch (Exception)
        {
            // best effort for temp files
        }
    }
}
