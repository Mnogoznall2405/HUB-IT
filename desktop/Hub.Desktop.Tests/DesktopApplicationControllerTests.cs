using Hub.Desktop.Lifecycle;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopApplicationControllerTests
{
    [Fact]
    public void PreparesShutdownOnlyOnceAndMarksExplicitExit()
    {
        var hideCount = 0;
        var controller = new DesktopApplicationController(() => hideCount++);

        controller.PrepareForShutdown();
        controller.PrepareForShutdown();

        Assert.True(controller.ExitRequested);
        Assert.Equal(1, hideCount);
    }
}
