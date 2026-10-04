using Hub.Desktop.Notifications;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopNotificationGroupingTests
{
    [Theory]
    [InlineData("/chat?conversation=7&message=42", "chat:7")]
    [InlineData("/chat?message=42&conversation=conv-1", "chat:conv-1")]
    [InlineData("/chat?conversation=a%20b", "chat:a b")]
    public void GroupsChatNotificationsByConversation(string route, string expected)
    {
        Assert.Equal(expected, DesktopNotificationGrouping.GetGroup(route));
    }

    [Theory]
    [InlineData("/tasks?task=t-9&task_detail_view=discussion&message=m-1", "task:t-9")]
    [InlineData("/tasks?task=t-9&task_detail_view=discussion", "task:t-9")]
    public void GroupsTaskDiscussionNotificationsByTask(string route, string expected)
    {
        Assert.Equal(expected, DesktopNotificationGrouping.GetGroup(route));
    }

    [Theory]
    [InlineData("chat:msg:42", "chat:7", "chat:7")]
    [InlineData("task:msg:1", "task:t-9", "task:t-9")]
    [InlineData("ticket:42", null, "ticket:42")]
    [InlineData("ticket:42", "", "ticket:42")]
    public void ResolvesTagFromGroupOrId(string id, string? group, string expected)
    {
        Assert.Equal(expected, DesktopNotificationGrouping.ResolveTag(id, group));
    }

    [Fact]
    public void ResolvedTagNeverExceedsWindowsLimit()
    {
        var tag = DesktopNotificationGrouping.ResolveTag("x", "chat:" + new string('a', 100));

        Assert.NotNull(tag);
        Assert.True(tag.Length <= DesktopNotificationGrouping.MaximumLength);
        Assert.Null(DesktopNotificationGrouping.ResolveTag(null, null));
    }

    [Theory]
    [InlineData("/chat")]
    [InlineData("/chat?conversation=")]
    [InlineData("/tasks")]
    [InlineData("/tasks?task=t-9")]
    [InlineData("/tasks?task_detail_view=discussion")]
    [InlineData("/tickets/42")]
    [InlineData("/mail?message=mail-1")]
    [InlineData("/chatroom?conversation=7")]
    public void DoesNotGroupOtherRoutes(string route)
    {
        Assert.Null(DesktopNotificationGrouping.GetGroup(route));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("/chat?conversation=%E0%A4%A&&=&conversation")]
    [InlineData("/chat?%%%=1&conversation=%ZZ")]
    [InlineData("?#?#")]
    [InlineData("/tasks?task=%&task_detail_view=%")]
    public void MalformedRoutesDoNotThrow(string? route)
    {
        var exception = Record.Exception(() => DesktopNotificationGrouping.GetGroup(route));

        Assert.Null(exception);
    }

    [Fact]
    public void LongGroupIsBoundedAndDeterministic()
    {
        var route = $"/chat?conversation={new string('c', 200)}&message=1";

        var first = DesktopNotificationGrouping.GetGroup(route);
        var second = DesktopNotificationGrouping.GetGroup($"/chat?conversation={new string('c', 200)}&message=2");
        var other = DesktopNotificationGrouping.GetGroup($"/chat?conversation={new string('d', 200)}");

        Assert.NotNull(first);
        Assert.True(first!.Length <= DesktopNotificationGrouping.MaximumLength);
        Assert.Equal(first, second);
        Assert.NotEqual(first, other);
    }

    [Fact]
    public void TagUsesRequestId()
    {
        Assert.Equal("chat:msg:42", DesktopNotificationGrouping.GetTag("chat:msg:42"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    public void EmptyIdProducesNoTag(string? id)
    {
        Assert.Null(DesktopNotificationGrouping.GetTag(id));
    }

    [Fact]
    public void LongTagIsBoundedAndDeterministic()
    {
        var id = $"chat:msg:{new string('x', 100)}";

        var tag = DesktopNotificationGrouping.GetTag(id);

        Assert.NotNull(tag);
        Assert.True(tag!.Length <= DesktopNotificationGrouping.MaximumLength);
        Assert.Equal(tag, DesktopNotificationGrouping.GetTag(id));
        Assert.NotEqual(tag, DesktopNotificationGrouping.GetTag($"chat:msg:{new string('y', 100)}"));
    }
}
