using Hub.Desktop.Configuration;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopOptionsTests
{
    [Fact]
    public void AcceptsHttpsOrigin()
    {
        var options = DesktopOptions.FromBaseUrl("https://hubit.zsgp.ru/");

        Assert.Equal("https://hubit.zsgp.ru/", options.BaseUri.AbsoluteUri);
    }

    [Theory]
    [InlineData("http://hubit.zsgp.ru/")]
    [InlineData("file:///C:/portal/index.html")]
    [InlineData("https://user:password@hubit.zsgp.ru/")]
    [InlineData("https://hubit.zsgp.ru/dashboard")]
    [InlineData("https://hubit.zsgp.ru/?target=dashboard")]
    public void RejectsUnsafeProductionBaseUrl(string baseUrl)
    {
        Assert.Throws<InvalidOperationException>(() => DesktopOptions.FromBaseUrl(baseUrl));
    }

    [Fact]
    public void AllowsHttpLoopbackIpv4WhenExplicitlyEnabled()
    {
        var options = DesktopOptions.FromBaseUrl("http://127.0.0.1:4173/", allowHttpLoopback: true);

        Assert.Equal("http://127.0.0.1:4173/", options.BaseUri.AbsoluteUri);
    }

    [Fact]
    public void RejectsDifferentHttpsOriginForRelease()
    {
        Assert.Throws<InvalidOperationException>(
            () => DesktopOptions.FromProductionBaseUrl("https://portal.example.com/"));
    }
}
