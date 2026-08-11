using Hub.Desktop.Security;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NavigationPolicyTests
{
    private readonly NavigationPolicy _policy = new(new Uri("https://hubit.zsgp.ru/"));

    [Theory]
    [InlineData("https://hubit.zsgp.ru/")]
    [InlineData("https://hubit.zsgp.ru/chat?conversation=123")]
    [InlineData("https://HUBIT.ZSGP.RU:443/tasks")]
    public void AllowsExactTrustedOrigin(string uri)
    {
        Assert.Equal(NavigationDisposition.TrustedOrigin, _policy.Evaluate(uri));
    }

    [Theory]
    [InlineData("https://hubit.zsgp.ru.example.com/")]
    [InlineData("https://evil.example/?next=https://hubit.zsgp.ru/")]
    [InlineData("https://hubit.zsgp.ru:8443/")]
    public void SendsOtherHttpsOriginsToSystemBrowser(string uri)
    {
        Assert.Equal(NavigationDisposition.ExternalBrowser, _policy.Evaluate(uri));
    }

    [Theory]
    [InlineData("mailto:support@zsgp.ru")]
    [InlineData("https://learn.microsoft.com/")]
    [InlineData("vnc://10.0.0.10:5901?launch_token=test-token&api_base=https%3A%2F%2Fhubit.zsgp.ru%2Fapi%2Fv1")]
    public void AllowsExplicitExternalSchemes(string uri)
    {
        Assert.True(_policy.TryGetExternalUri(uri, out _));
    }

    [Theory]
    [InlineData("http://hubit.zsgp.ru/")]
    [InlineData("file:///C:/Windows/System32/cmd.exe")]
    [InlineData("javascript:alert(1)")]
    [InlineData("data:text/html,hello")]
    [InlineData("shell:AppsFolder")]
    [InlineData("powershell:Write-Host")]
    [InlineData("not a uri")]
    public void BlocksUnsafeOrUnknownSchemes(string uri)
    {
        Assert.Equal(NavigationDisposition.Blocked, _policy.Evaluate(uri));
    }
}
