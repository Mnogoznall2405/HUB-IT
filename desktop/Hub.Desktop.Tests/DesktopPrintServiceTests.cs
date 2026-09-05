using Hub.Desktop.Printing;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopPrintServiceTests
{
    private static readonly Uri TrustedOrigin = new("https://hubit.zsgp.ru/");

    [Theory]
    [InlineData("https://hubit.zsgp.ru/dashboard")]
    [InlineData("https://hubit.zsgp.ru/my-files?view=preview")]
    public void AllowsTrustedNonSensitivePages(string source)
    {
        Assert.True(DesktopPrintService.CanPrintCurrent(TrustedOrigin, source));
    }

    [Theory]
    [InlineData("https://evil.example/document")]
    [InlineData("https://hubit.zsgp.ru/login")]
    [InlineData("https://hubit.zsgp.ru/shared-files/secret")]
    [InlineData("https://hubit.zsgp.ru/my-files?download_token=secret")]
    [InlineData("data:text/html,secret")]
    [InlineData("blob:https://hubit.zsgp.ru/id")]
    public void RejectsUntrustedOrSensitivePages(string source)
    {
        Assert.False(DesktopPrintService.CanPrintCurrent(TrustedOrigin, source));
    }

    [Fact]
    public void UsesA4SheetsForEquipmentQrLabels()
    {
        Assert.Equal(210d / 25.4d, DesktopPrintService.A4WidthInInches, 8);
        Assert.Equal(297d / 25.4d, DesktopPrintService.A4HeightInInches, 8);
    }
}
