using System.Drawing;
using Hub.Desktop.Lifecycle;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopWindowControllerTests
{
    [Fact]
    public void CalculatesMaximizedBoundsInsideMonitorWorkArea()
    {
        var monitor = new Rectangle(-1920, 0, 1920, 1080);
        var workArea = new Rectangle(-1920, 40, 1920, 1040);

        var bounds = DesktopWindowController.CalculateMaximizedBounds(
            monitor,
            workArea);

        Assert.Equal(new DesktopMaximizedBounds(0, 40, 1920, 1040), bounds);
    }
}
