using Hub.Desktop.DeepLinks;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopLaunchRequestTests
{
    [Theory]
    [InlineData("--background")]
    [InlineData("--BACKGROUND")]
    public void ParsesBackgroundLaunch(string argument)
    {
        Assert.True(DesktopLaunchRequest.TryParse([argument], out var request));
        Assert.True(request.StartInBackground);
        Assert.Null(request.Route);
        Assert.False(request.OpenDownloads);
    }

    [Fact]
    public void ParsesRouteLaunch()
    {
        Assert.True(DesktopLaunchRequest.TryParse(["--route", "/tasks?task=7"], out var request));
        Assert.Equal("/tasks?task=7", request.Route);
    }

    [Fact]
    public void ParsesDownloadsLaunch()
    {
        Assert.True(DesktopLaunchRequest.TryParse(["--downloads"], out var request));
        Assert.True(request.OpenDownloads);
    }

    [Theory]
    [InlineData("--route")]
    [InlineData("--route", "https://evil.example")]
    [InlineData("--route", "/tasks", "extra")]
    [InlineData("--unknown")]
    [InlineData("--background", "--route", "/tasks")]
    public void RejectsMalformedArgumentSets(params string[] arguments)
    {
        Assert.False(DesktopLaunchRequest.TryParse(arguments, out _));
    }
}
