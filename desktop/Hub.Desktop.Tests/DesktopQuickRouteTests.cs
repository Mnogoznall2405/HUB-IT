using Hub.Desktop.Shell;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopQuickRouteTests
{
    [Theory]
    [InlineData(0, "Задачи", "Открыть Задачи")]
    [InlineData(3, "Задачи — 3", "Открыть Задачи, новых: 3")]
    public void BuildsAccessibleMenuText(int badge, string expectedText, string expectedAccessibleName)
    {
        var route = new DesktopQuickRoute("tasks", "Задачи", "/tasks", badge);

        Assert.Equal(expectedText, route.MenuText);
        Assert.Equal(expectedAccessibleName, route.AccessibleName);
    }
}
