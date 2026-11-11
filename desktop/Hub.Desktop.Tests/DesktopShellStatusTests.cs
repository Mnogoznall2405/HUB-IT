using Hub.Desktop.Shell;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopShellStatusTests
{
    [Fact]
    public void AnonymousStatusDoesNotExposeCounters()
    {
        var status = new DesktopShellStatus(
            Authenticated: false,
            Online: true,
            UnreadTotal: 7,
            ChatUnread: 4,
            MailUnread: 2,
            TasksAttention: 1);

        Assert.Equal("HUB Desktop", status.TrayToolTip);
        Assert.False(status.ShouldShowTaskbarBadge(windowForeground: false));
    }

    [Theory]
    [InlineData(0, "")]
    [InlineData(1, "1")]
    [InlineData(99, "99")]
    [InlineData(100, "99+")]
    public void FormatsBoundedTaskbarBadge(int unreadTotal, string expected)
    {
        var status = new DesktopShellStatus(true, true, unreadTotal, 0, 0, 0);

        Assert.Equal(expected, status.TaskbarBadgeText);
    }

    [Fact]
    public void ShowsTaskbarBadgeOnlyOutsideForeground()
    {
        var status = new DesktopShellStatus(true, true, 7, 4, 2, 1);

        Assert.False(status.ShouldShowTaskbarBadge(windowForeground: true));
        Assert.True(status.ShouldShowTaskbarBadge(windowForeground: false));
        Assert.Equal("HUB Desktop — 7 новых", status.TrayToolTip);
    }

    [Fact]
    public void IncludesOfflineStateWithoutLosingUnreadCount()
    {
        var status = new DesktopShellStatus(true, false, 7, 4, 2, 1);

        Assert.Equal("HUB Desktop — нет сети, 7 новых", status.TrayToolTip);
    }

    [Fact]
    public void ReusesTheSameFrozenBadgeImageAcrossRepeatedUpdates()
    {
        var first = DesktopTaskbarBadgeRenderer.Create("7");

        for (var index = 0; index < 10_000; index++)
        {
            Assert.Same(first, DesktopTaskbarBadgeRenderer.Create("7"));
        }

        Assert.True(first.IsFrozen);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("100")]
    [InlineData("text")]
    public void RejectsUnboundedTaskbarBadgeText(string text)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            DesktopTaskbarBadgeRenderer.Create(text));
    }
}
