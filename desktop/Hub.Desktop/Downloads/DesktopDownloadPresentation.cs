namespace Hub.Desktop.Downloads;

public static class DesktopDownloadPresentation
{
    public static string GetActionMessage(DesktopFileActionResult result) => result switch
    {
        DesktopFileActionResult.Succeeded => string.Empty,
        DesktopFileActionResult.NoHandler =>
            "Для этого типа файла не найдено установленное приложение.",
        DesktopFileActionResult.Missing =>
            "Файл больше недоступен. Скачайте его повторно в HUB.",
        DesktopFileActionResult.Unsupported =>
            "Этот тип файла нельзя открывать из HUB Desktop.",
        _ => "Не удалось выполнить действие с файлом. Повторите попытку.",
    };
}
