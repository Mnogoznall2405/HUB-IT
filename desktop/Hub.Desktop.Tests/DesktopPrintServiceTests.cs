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

    [Theory]
    [InlineData("{\"widthMm\":56,\"heightMm\":50}", 56, 50)]
    [InlineData("{\"widthMm\":210,\"heightMm\":297}", 210, 297)]
    public void ReadsPageSizeFromThePreparedPrintJob(string json, double widthMm, double heightMm)
    {
        Assert.True(DesktopPrintService.TryGetEquipmentQrPageSize(json, out var width, out var height));
        Assert.Equal(widthMm / 25.4d, width, 8);
        Assert.Equal(heightMm / 25.4d, height, 8);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("{}")]
    [InlineData("invalid-json")]
    [InlineData("{\"widthMm\":0,\"heightMm\":50}")]
    [InlineData("{\"widthMm\":50,\"heightMm\":-1}")]
    [InlineData("{\"widthMm\":500,\"heightMm\":50}")]
    [InlineData("{\"widthMm\":50,\"heightMm\":500}")]
    [InlineData("{\"widthMm\":\"50\",\"heightMm\":50}")]
    [InlineData("{\"widthMm\":1e400,\"heightMm\":50}")]
    public void RejectsMissingOrInvalidPrintPageSizes(string json)
    {
        Assert.False(DesktopPrintService.TryGetEquipmentQrPageSize(json, out _, out _));
    }
}
