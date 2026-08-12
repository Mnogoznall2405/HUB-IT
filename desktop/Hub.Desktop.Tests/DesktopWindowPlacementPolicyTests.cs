using System.Drawing;
using Hub.Desktop.Configuration;
using Hub.Desktop.Workspace;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopWindowPlacementPolicyTests
{
    private static readonly Rectangle Primary = new(0, 0, 1920, 1040);
    private static readonly Rectangle Secondary = new(-1920, 0, 1920, 1080);

    [Fact]
    public void KeepsVisiblePlacementOnItsExistingMonitor()
    {
        var placement = new DesktopWindowPlacement(-1800, 80, 1360, 860, true);

        var normalized = DesktopWindowPlacementPolicy.Normalize(
            placement,
            [Primary, Secondary],
            Primary);

        Assert.Equal(placement, normalized);
    }

    [Fact]
    public void CentersPlacementOnPrimaryWhenSavedMonitorWasRemoved()
    {
        var placement = new DesktopWindowPlacement(4000, 200, 1360, 860, false);

        var normalized = DesktopWindowPlacementPolicy.Normalize(placement, [Primary], Primary);

        Assert.Equal(new DesktopWindowPlacement(280, 90, 1360, 860, false), normalized);
    }

    [Fact]
    public void ClampsOversizedPlacementToSmallWorkArea()
    {
        var smallPrimary = new Rectangle(0, 0, 1280, 720);
        var placement = new DesktopWindowPlacement(10, 10, 4000, 3000, false);

        var normalized = DesktopWindowPlacementPolicy.Normalize(
            placement,
            [smallPrimary],
            smallPrimary);

        Assert.Equal(new DesktopWindowPlacement(0, 0, 1280, 720, false), normalized);
    }
}
