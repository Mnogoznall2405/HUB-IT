namespace Hub.Desktop.Lifecycle;

internal static class WindowsAppRuntime
{
    public static string DescribeStatus(
        bool elevationKnown,
        bool isElevated,
        bool notificationsAvailable)
    {
        if (!elevationKnown)
        {
            return "Не проверен: не удалось определить права запуска";
        }

        if (isElevated)
        {
            return "Отключён: HUB запущен от администратора";
        }

        return notificationsAvailable
            ? "Встроен; системные уведомления доступны"
            : "Встроен; системные уведомления не поддерживаются";
    }
}
