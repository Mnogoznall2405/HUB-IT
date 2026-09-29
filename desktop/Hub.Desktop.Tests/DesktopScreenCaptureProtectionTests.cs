using Hub.Desktop.Security;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopScreenCaptureProtectionTests
{
    private static readonly Uri TrustedBaseUri = new("https://hubit.zsgp.ru/");

    [Theory]
    [InlineData("https://hubit.zsgp.ru/passwords")]
    [InlineData("https://hubit.zsgp.ru/Passwords")]
    [InlineData("https://hubit.zsgp.ru/passwords?section=ad-expiry")]
    [InlineData("https://hubit.zsgp.ru/passwords/entry-1")]
    public void DetectsVaultSource(string source)
    {
        Assert.True(DesktopScreenCaptureProtection.IsVaultSource(TrustedBaseUri, source));
    }

    [Theory]
    [InlineData("https://hubit.zsgp.ru/")]
    [InlineData("https://hubit.zsgp.ru/chat")]
    [InlineData("https://hubit.zsgp.ru/passwords-extra")]
    [InlineData("https://evil.example/passwords")]
    [InlineData("not-a-uri")]
    [InlineData(null)]
    public void IgnoresNonVaultSources(string? source)
    {
        Assert.False(DesktopScreenCaptureProtection.IsVaultSource(TrustedBaseUri, source));
    }
}
