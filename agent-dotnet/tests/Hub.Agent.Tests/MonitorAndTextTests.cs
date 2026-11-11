using Hub.Agent.Core.Inventory.Collectors;
using Hub.Agent.Core.Support;
using Xunit;

namespace Hub.Agent.Tests;

public sealed class MonitorAndTextTests
{
    [Fact]
    public void EdidSerialIsReadFromTheDescriptorBlock()
    {
        var edid = new byte[128];
        edid[54] = 0x00;
        edid[55] = 0x00;
        edid[56] = 0x00;
        edid[57] = 0xFF;
        var serial = "SN123456"u8.ToArray();
        Array.Copy(serial, 0, edid, 59, serial.Length);
        edid[72] = 0x0A;

        Assert.Equal("SN123456", MonitorCollector.ParseEdidSerial(edid));
    }

    [Fact]
    public void EdidWithoutSerialDescriptorReturnsEmpty()
    {
        Assert.Equal(string.Empty, MonitorCollector.ParseEdidSerial(new byte[128]));
        Assert.Equal(string.Empty, MonitorCollector.ParseEdidSerial(Array.Empty<byte>()));
    }

    [Theory]
    [InlineData("00000000", "")]
    [InlineData("FFFFFFFF", "")]
    [InlineData("ABC-123_x.y", "ABC-123_x.y")]
    [InlineData("SN 12/34", "SN1234")]
    public void MonitorSerialIsValidatedLikeThePythonAgent(string input, string expected)
    {
        Assert.Equal(expected, MonitorCollector.ValidateSerial(input));
    }

    [Fact]
    public void TextCollapsesNullsAndWhitespace()
    {
        Assert.Equal("a b", Text.CompactSpaces(" a\u0000  b "));
        Assert.Equal(string.Empty, Text.Sanitize(null));
        Assert.Equal("x", Text.Sanitize("x\u0000"));
    }

    [Fact]
    public void DedupeKeepsFirstOccurrenceAndOrder()
    {
        Assert.Equal(new[] { "a", "b" }, Text.Dedupe(new[] { "a", "b", "a", "", null }));
    }
}
