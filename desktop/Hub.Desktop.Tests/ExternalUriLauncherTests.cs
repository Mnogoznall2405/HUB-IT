using System.Diagnostics;
using Hub.Desktop.Security;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class ExternalUriLauncherTests
{
    private readonly NavigationPolicy _policy = new(new Uri("https://hubit.zsgp.ru/"));

    [Fact]
    public void OpensAllowedUriWithSystemShell()
    {
        ProcessStartInfo? captured = null;
        var launcher = new ExternalUriLauncher(
            _policy,
            startInfo =>
            {
                captured = startInfo;
                return true;
            });

        var result = launcher.Open("http://10.109.0.116/");

        Assert.Equal(ExternalUriLaunchStatus.Opened, result.Status);
        Assert.Equal("http", result.Scheme);
        Assert.NotNull(captured);
        Assert.Equal("http://10.109.0.116/", captured.FileName);
        Assert.True(captured.UseShellExecute);
    }

    [Theory]
    [InlineData("https://hubit.zsgp.ru/mfu")]
    [InlineData("http://public.example/")]
    [InlineData("file:///C:/Windows/System32/cmd.exe")]
    public void RejectsUriThatIsNotEligibleForExternalHandoff(string uri)
    {
        var startCalls = 0;
        var launcher = new ExternalUriLauncher(
            _policy,
            _ =>
            {
                startCalls++;
                return true;
            });

        var result = launcher.Open(uri);

        Assert.Equal(ExternalUriLaunchStatus.Blocked, result.Status);
        Assert.Equal(0, startCalls);
    }

    [Fact]
    public void ReportsSystemHandlerFailureWithoutThrowing()
    {
        var expected = new InvalidOperationException("No registered handler");
        var launcher = new ExternalUriLauncher(
            _policy,
            _ => throw expected);

        var result = launcher.Open("https://learn.microsoft.com/");

        Assert.Equal(ExternalUriLaunchStatus.Failed, result.Status);
        Assert.Same(expected, result.Error);
    }
}
