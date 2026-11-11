using Hub.Desktop.Notifications;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopNotificationPresentationTests
{
    [Theory]
    [InlineData("/chat?conversation=7&message=42")]
    [InlineData("/mail?message=mail-1")]
    public void UsesReplyActionForConversationRoutes(string route)
    {
        Assert.Equal("Ответить", DesktopNotificationPresentation.GetPrimaryActionLabel(route));
    }

    [Theory]
    [InlineData("/tasks")]
    [InlineData("/tickets/42")]
    [InlineData("/notifications")]
    public void UsesOpenActionForOtherNotificationRoutes(string route)
    {
        Assert.Equal("Открыть", DesktopNotificationPresentation.GetPrimaryActionLabel(route));
    }
}
