using Hub.Desktop.DeepLinks;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopDeepLinkParserTests
{
    [Theory]
    [InlineData("hubit://open/tasks", "/tasks")]
    [InlineData("HUBIT://OPEN/chat?conversation=conv-42", "/chat?conversation=conv-42")]
    [InlineData("hubit://open/networks/branch-1", "/networks/branch-1")]
    public void AcceptsAllowlistedProtocolRoutes(string input, string expected)
    {
        Assert.True(DesktopDeepLinkParser.TryParseProtocolUri(input, out var route));
        Assert.Equal(expected, route);
    }

    [Theory]
    [InlineData("https://hubit.zsgp.ru/tasks")]
    [InlineData("hubit://evil/tasks")]
    [InlineData("hubit://user@open/tasks")]
    [InlineData("hubit://open:42/tasks")]
    [InlineData("hubit://open//evil.example")]
    [InlineData("hubit://open/chat%2Fescape")]
    [InlineData("hubit://open/chat%252Fescape")]
    [InlineData("hubit://open/chat?token=secret")]
    [InlineData("hubit://open/login")]
    [InlineData("hubit://open/tasks#fragment")]
    [InlineData("hubit://open/C:/Windows/System32")]
    public void RejectsUntrustedProtocolInput(string input)
    {
        Assert.False(DesktopDeepLinkParser.TryParseProtocolUri(input, out _));
    }

    [Theory]
    [InlineData("/dashboard")]
    [InlineData("/tasks?task=123")]
    [InlineData("/chat?conversation=conv-1&message=msg-2")]
    [InlineData("/networks/branch_1")]
    public void AcceptsAllowlistedInternalRoutes(string input)
    {
        Assert.True(DesktopDeepLinkParser.TryParseInternalRoute(input, out var route));
        Assert.Equal(input, route);
    }

    [Theory]
    [InlineData("//evil.example/tasks")]
    [InlineData("/unknown")]
    [InlineData("/login")]
    [InlineData("/shared-files/secret")]
    [InlineData("/tasks?download_token=secret")]
    [InlineData("/networks/a/b")]
    [InlineData("/tasks\\evil")]
    [InlineData("/tasks\nnext")]
    public void RejectsUnsafeInternalRoutes(string input)
    {
        Assert.False(DesktopDeepLinkParser.TryParseInternalRoute(input, out _));
    }

    [Fact]
    public void RejectsOverlongInput()
    {
        var input = "hubit://open/chat?conversation=" + new string('a', 2048);

        Assert.False(DesktopDeepLinkParser.TryParseProtocolUri(input, out _));
    }
}
