using Hub.Desktop.Lifecycle;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class WindowsAppRuntimeTests
{
    [Fact]
    public void ExplainsWhenRuntimeIsDisabledByElevatedLaunch()
    {
        var status = WindowsAppRuntime.DescribeStatus(
            elevationKnown: true,
            isElevated: true,
            notificationsAvailable: false);

        Assert.Equal("Отключён: HUB запущен от администратора", status);
    }

    [Fact]
    public void ReportsSelfContainedRuntimeWithoutDynamicDependencyBootstrap()
    {
        var status = WindowsAppRuntime.DescribeStatus(
            elevationKnown: true,
            isElevated: false,
            notificationsAvailable: true);

        Assert.Equal("Встроен; системные уведомления доступны", status);
    }

    [Fact]
    public void ExplainsWhenWindowsDoesNotSupportTheSystemChannel()
    {
        var status = WindowsAppRuntime.DescribeStatus(
            elevationKnown: true,
            isElevated: false,
            notificationsAvailable: false);

        Assert.Equal("Встроен; системные уведомления не поддерживаются", status);
    }
}
