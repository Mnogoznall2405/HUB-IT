using Hub.Agent.Core.Configuration;
using Hub.Agent.Core.Support;
using Xunit;

namespace Hub.Agent.Tests;

public sealed class AgentConfigTests
{
    private static Dictionary<string, string?> Env(params (string Key, string Value)[] pairs)
        => pairs.ToDictionary(pair => pair.Key, pair => (string?)pair.Value, StringComparer.OrdinalIgnoreCase);

    [Fact]
    public void ClampsKeepTheSameBoundsAsThePythonAgent()
    {
        var config = AgentConfig.Load(Env(
            ("ITINV_AGENT_INTERVAL_SEC", "10"),
            ("ITINV_AGENT_HEARTBEAT_SEC", "5"),
            ("ITINV_AGENT_HEARTBEAT_JITTER_SEC", "1000"),
            ("ITINV_INVENTORY_QUEUE_BATCH", "0"),
            ("ITINV_INVENTORY_QUEUE_MAX_ITEMS", "1"),
            ("ITINV_INVENTORY_QUEUE_MAX_AGE_DAYS", "1000")));

        Assert.Equal(300, config.FullSnapshotIntervalSec);
        Assert.Equal(60, config.HeartbeatIntervalSec);
        Assert.Equal(300, config.HeartbeatJitterSec);
        Assert.Equal(1, config.InventoryQueueBatch);
        Assert.Equal(50, config.InventoryQueueMaxItems);
        Assert.Equal(90, config.InventoryQueueMaxAgeDays);
    }

    [Fact]
    public void HeartbeatNeverExceedsFullSnapshotInterval()
    {
        var config = AgentConfig.Load(Env(
            ("ITINV_AGENT_INTERVAL_SEC", "600"),
            ("ITINV_AGENT_HEARTBEAT_SEC", "900")));

        Assert.Equal(600, config.FullSnapshotIntervalSec);
        Assert.Equal(600, config.HeartbeatIntervalSec);
    }

    [Fact]
    public void PilotInstallUsesIsolatedProgramDataFolder()
    {
        var paths = new AgentPaths(@"C:\ProgramData", "HUB-IT-CSharp");

        Assert.Equal(@"C:\ProgramData\HUB-IT-CSharp\Agent", paths.AgentRoot);
        Assert.Equal(@"C:\ProgramData\HUB-IT-CSharp\Agent\Spool", paths.SpoolDir);
    }

    [Fact]
    public void DefaultsMatchThePythonAgent()
    {
        var config = AgentConfig.Load(Env());

        Assert.Equal(AgentConfig.DefaultServerUrl, config.ServerUrl);
        Assert.Equal(3600, config.FullSnapshotIntervalSec);
        Assert.Equal(600, config.HeartbeatIntervalSec);
        Assert.Equal(120, config.HeartbeatJitterSec);
        Assert.Equal(5, config.InventoryQueueBatch);
        Assert.Equal(1000, config.InventoryQueueMaxItems);
    }

    [Fact]
    public void InvalidReminderWindowFallsBackToDefaults()
    {
        var warnings = new List<string>();
        var config = AgentConfig.Load(
            Env(
                ("ITINV_REBOOT_REMINDER_WORK_START_HOUR", "20"),
                ("ITINV_REBOOT_REMINDER_WORK_END_HOUR", "8")),
            warnings.Add);

        Assert.Equal(9, config.RebootReminderWorkStartHour);
        Assert.Equal(18, config.RebootReminderWorkEndHour);
        Assert.Single(warnings);
    }

    [Fact]
    public void MissingCaBundleFallsBackToDefaultTls()
    {
        var warnings = new List<string>();
        var config = AgentConfig.Load(
            Env(("ITINV_AGENT_CA_BUNDLE", @"C:\does-not-exist\ca.pem")),
            warnings.Add);

        Assert.Null(config.CaBundle);
        Assert.Single(warnings);
    }

    [Fact]
    public void EnvFileDoesNotOverrideProcessEnvironment()
    {
        var root = Path.Combine(Path.GetTempPath(), "hub-agent-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        var envFile = Path.Combine(root, ".env");
        File.WriteAllText(envFile, "ITINV_AGENT_API_KEY=from-file\nexport ITINV_AGENT_INTERVAL_SEC=1800\nBROKEN LINE\n");

        var environment = new System.Collections.Hashtable
        {
            ["ITINV_AGENT_API_KEY"] = "from-process",
        };

        var loaded = EnvLoader.LoadFile(environment, envFile);

        Assert.Equal(1, loaded);
        Assert.Equal("from-process", environment["ITINV_AGENT_API_KEY"]);
        Assert.Equal("1800", environment["ITINV_AGENT_INTERVAL_SEC"]);
    }

    [Theory]
    [InlineData("1", true)]
    [InlineData("true", true)]
    [InlineData("yes", true)]
    [InlineData("0", false)]
    [InlineData("off", false)]
    [InlineData(null, true)]
    public void TruthyUsesPythonSemantics(string? value, bool expected)
    {
        Assert.Equal(expected, Text.Truthy(value, fallback: true));
    }
}
