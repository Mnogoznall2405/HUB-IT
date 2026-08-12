using Hub.Desktop.Workspace;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopWorkspaceRoutePolicyTests
{
    private static readonly Uri TrustedBaseUri = new("https://hubit.zsgp.ru/");

    [Theory]
    [InlineData("https://hubit.zsgp.ru/dashboard", "/dashboard")]
    [InlineData("https://hubit.zsgp.ru/chat?conversation=42", "/chat?conversation=42")]
    [InlineData("https://hubit.zsgp.ru/networks/branch-1", "/networks/branch-1")]
    public void AcceptsSafeTrustedRoutes(string url, string expectedRoute)
    {
        Assert.True(DesktopWorkspaceRoutePolicy.TryGetSafeRoute(TrustedBaseUri, url, out var route));
        Assert.Equal(expectedRoute, route);
    }

    [Theory]
    [InlineData("https://evil.example/dashboard")]
    [InlineData("https://hubit.zsgp.ru/login")]
    [InlineData("https://hubit.zsgp.ru/shared-files/secret")]
    [InlineData("https://hubit.zsgp.ru/chat?token=secret")]
    [InlineData("https://hubit.zsgp.ru/chat?%2574oken=secret")]
    [InlineData("https://hubit.zsgp.ru/chat?%E0%A4%A=secret")]
    [InlineData("https://hubit.zsgp.ru/chat%2Fescape")]
    [InlineData("https://hubit.zsgp.ru/chat#message-1")]
    public void RejectsSensitiveOrUntrustedRoutes(string url)
    {
        Assert.False(DesktopWorkspaceRoutePolicy.TryGetSafeRoute(TrustedBaseUri, url, out _));
    }
}
