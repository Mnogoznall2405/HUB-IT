using Hub.Agent.Core.Inventory.Collectors;
using Xunit;

namespace Hub.Agent.Tests;

public sealed class DiskReliabilityTests
{
    [Theory]
    [InlineData("0", "0")]
    [InlineData(@"\\.\PHYSICALDRIVE0", "0")]
    [InlineData(@"\\.\PHYSICALDRIVE12", "12")]
    [InlineData("PHYSICALDRIVE3", "3")]
    [InlineData(" 7 ", "7")]
    [InlineData("", "")]
    public void ReliabilityKeyNormalizesWmiDeviceIds(string value, string expected)
    {
        Assert.Equal(expected, DiskCollector.ReliabilityKey(value));
    }

    [Fact]
    public void WearAndTemperatureAreFilledFromCounter()
    {
        var disk = new Dictionary<string, object?>
        {
            ["wear_out_percentage"] = null,
            ["temperature"] = null,
            ["extended_info"] = new Dictionary<string, object?>(),
        };
        var counter = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase)
        {
            ["Wear"] = 17L,
            ["Temperature"] = 41L,
            ["PowerOnHours"] = 12345L,
            ["StartStopCycleCount"] = 88L,
        };

        DiskCollector.ApplyReliabilityCounter(disk, counter);

        Assert.Equal(17L, disk["wear_out_percentage"]);
        Assert.Equal(41L, disk["temperature"]);
        var extended = Assert.IsType<Dictionary<string, object?>>(disk["extended_info"]);
        Assert.Equal(12345L, extended["power_on_hours"]);
        Assert.Equal(88L, extended["start_stop_cycle_count"]);
    }

    [Fact]
    public void MissingCounterKeepsNulls()
    {
        var disk = new Dictionary<string, object?>
        {
            ["wear_out_percentage"] = null,
            ["temperature"] = null,
            ["extended_info"] = new Dictionary<string, object?>(),
        };

        DiskCollector.ApplyReliabilityCounter(disk, null);
        DiskCollector.ApplyReliabilityCounter(disk, new Dictionary<string, object?>());

        Assert.Null(disk["wear_out_percentage"]);
        Assert.Null(disk["temperature"]);
    }
}
