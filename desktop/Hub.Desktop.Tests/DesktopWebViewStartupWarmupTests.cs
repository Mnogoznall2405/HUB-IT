using Hub.Desktop.WebView;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopWebViewStartupWarmupTests
{
    [Theory]
    [InlineData(true, false, true)]
    [InlineData(true, true, false)]
    [InlineData(false, false, false)]
    [InlineData(false, true, false)]
    public void RequestsWarmupOnlyOnceAfterBackgroundStart(
        bool startedHidden,
        bool alreadyWarmed,
        bool expected)
    {
        Assert.Equal(
            expected,
            DesktopWebViewStartupWarmup.ShouldWarmup(startedHidden, alreadyWarmed));
    }

    [Theory]
    [InlineData(true, true)]
    [InlineData(false, false)]
    public void DefersWebViewCreationOnlyForBackgroundStart(
        bool startedHidden,
        bool expected)
    {
        Assert.Equal(
            expected,
            DesktopWebViewStartupWarmup.ShouldDeferWebViewCreation(startedHidden));
    }
}
