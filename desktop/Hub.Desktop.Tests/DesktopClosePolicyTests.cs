using Hub.Desktop.Lifecycle;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopClosePolicyTests
{
    [Fact]
    public void NormalCloseKeepsTheApplicationInTheTaskbar()
    {
        var action = DesktopClosePolicy.Resolve(
            exitRequested: false,
            performanceBenchEnabled: false);

        Assert.Equal(DesktopCloseAction.MinimizeToTaskbar, action);
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public void ExplicitExitAndPerformanceBenchCloseTheWindow(
        bool exitRequested,
        bool performanceBenchEnabled)
    {
        var action = DesktopClosePolicy.Resolve(exitRequested, performanceBenchEnabled);

        Assert.Equal(DesktopCloseAction.Exit, action);
    }
}
