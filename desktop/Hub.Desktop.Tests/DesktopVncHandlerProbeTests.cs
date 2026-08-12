using Hub.Desktop.Remote;
using Microsoft.Win32;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopVncHandlerProbeTests
{
    [Fact]
    public void FindsACompleteRegistrationInAnySupportedRegistryView()
    {
        var reads = 0;
        var probe = new DesktopVncHandlerProbe((_, _) =>
        {
            reads++;
            return reads == 3
                ? new DesktopVncProtocolRegistration(true, "viewer.exe \"%1\"")
                : default;
        });

        Assert.True(probe.IsAvailable());
        Assert.Equal(3, reads);
    }

    [Theory]
    [InlineData(false, "viewer.exe \"%1\"")]
    [InlineData(true, null)]
    [InlineData(true, "   ")]
    public void RejectsIncompleteRegistrations(bool hasMarker, string? command)
    {
        var probe = new DesktopVncHandlerProbe((_, _) =>
            new DesktopVncProtocolRegistration(hasMarker, command));

        Assert.False(probe.IsAvailable());
    }

    [Fact]
    public void TreatsUnreadableViewsAsUnavailableAndContinues()
    {
        var reads = 0;
        var probe = new DesktopVncHandlerProbe((RegistryHive _, RegistryView _) =>
        {
            reads++;
            if (reads == 1)
            {
                throw new UnauthorizedAccessException();
            }

            return reads == 2
                ? new DesktopVncProtocolRegistration(true, "viewer.exe \"%1\"")
                : default;
        });

        Assert.True(probe.IsAvailable());
        Assert.Equal(2, reads);
    }
}
