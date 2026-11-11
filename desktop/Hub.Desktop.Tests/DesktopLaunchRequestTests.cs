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

    [Fact]
    public void ParsesSingleSharedFileLaunch()
    {
        Assert.True(DesktopLaunchRequest.TryParse(["--share", "C:\\file.pdf"], out var request));
        Assert.Equal(new[] { "C:\\file.pdf" }, request.SharedFiles);
        Assert.True(request.HasSharedFiles);
    }

    [Fact]
    public void ParsesMultipleSharedFileLaunch()
    {
        Assert.True(DesktopLaunchRequest.TryParse(
            ["--share", "C:\\a.pdf", "C:\\b.pdf", "C:\\c.pdf"],
            out var request));
        Assert.Equal(new[] { "C:\\a.pdf", "C:\\b.pdf", "C:\\c.pdf" }, request.SharedFiles);
    }

    [Fact]
    public void RejectsEmptySharedFileList()
    {
        Assert.False(DesktopLaunchRequest.TryParse(["--share"], out _));
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
