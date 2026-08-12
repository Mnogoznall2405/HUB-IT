using System.Windows;
using System.Windows.Shell;
using Hub.Desktop.Diagnostics;
using Application = System.Windows.Application;

namespace Hub.Desktop.Shell;

public sealed record DesktopJumpListEntry(
    string Title,
    string Arguments,
    string Description);

public static class DesktopJumpListService
{
    public static IReadOnlyList<DesktopJumpListEntry> CreateEntries() =>
    [
        new("Главная", "--route /dashboard", "Открыть главную страницу HUB"),
        new("Задачи", "--route /tasks", "Открыть задачи HUB"),
        new("Чат", "--route /chat", "Открыть чат HUB"),
        new("Почта", "--route /mail", "Открыть почту HUB"),
        new("Загрузки", "--downloads", "Открыть загрузки HUB Desktop"),
    ];

    public static bool TryApply(Application application, string executablePath)
    {
        ArgumentNullException.ThrowIfNull(application);
        ArgumentException.ThrowIfNullOrWhiteSpace(executablePath);

        try
        {
            var jumpList = new JumpList
            {
                ShowFrequentCategory = false,
                ShowRecentCategory = false,
            };
            foreach (var entry in CreateEntries())
            {
                jumpList.JumpItems.Add(new JumpTask
                {
                    ApplicationPath = executablePath,
                    Arguments = entry.Arguments,
                    CustomCategory = "HUB",
                    Description = entry.Description,
                    IconResourcePath = executablePath,
                    Title = entry.Title,
                    WorkingDirectory = AppContext.BaseDirectory,
                });
            }

            JumpList.SetJumpList(application, jumpList);
            jumpList.Apply();
            return true;
        }
        catch (Exception exception) when (
            exception is InvalidOperationException
            or UnauthorizedAccessException
            or System.Runtime.InteropServices.COMException)
        {
            DesktopLog.Error("Windows Jump List could not be configured", exception);
            return false;
        }
    }
}
