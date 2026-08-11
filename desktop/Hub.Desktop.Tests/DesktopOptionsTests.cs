using Hub.Desktop.Configuration;

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
    public void AllowsHttpLoopbackOnlyWhenExplicitlyEnabled()
    {
        var options = DesktopOptions.FromBaseUrl("http://localhost:5173/", allowHttpLoopback: true);

        Assert.Equal("http://localhost:5173/", options.BaseUri.AbsoluteUri);
    }
}
