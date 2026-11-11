using Hub.Desktop.Downloads;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopDownloadPresentationTests
{
    [Theory]
    [InlineData(DesktopFileActionResult.Succeeded, "")]
    [InlineData(DesktopFileActionResult.NoHandler, "Для этого типа файла не найдено установленное приложение.")]
    [InlineData(DesktopFileActionResult.Missing, "Файл больше недоступен. Скачайте его повторно в HUB.")]
    [InlineData(DesktopFileActionResult.Unsupported, "Этот тип файла нельзя открывать из HUB Desktop.")]
    [InlineData(DesktopFileActionResult.Failed, "Не удалось выполнить действие с файлом. Повторите попытку.")]
    public void MapsFileActionsToSafeUserFeedback(
        DesktopFileActionResult result,
        string expectedMessage)
    {
        Assert.Equal(expectedMessage, DesktopDownloadPresentation.GetActionMessage(result));
    }
}
