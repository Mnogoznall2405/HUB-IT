using Hub.Desktop.DeepLinks;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopDeepLinkParserTests
{
    [Theory]
    [InlineData("hubit://open/tasks", "/tasks")]
    [InlineData("HUBIT://OPEN/chat?conversation=conv-42", "/chat?conversation=conv-42")]
    [InlineData("hubit://open/networks/branch-1", "/networks/branch-1")]
    public void AcceptsAllowlistedProtocolRoutes(string input, string expected)
    {
        Assert.True(DesktopDeepLinkParser.TryParseProtocolUri(input, out var route));
        Assert.Equal(expected, route);
    }

    [Theory]
    [InlineData("https://hubit.zsgp.ru/tasks")]
    [InlineData("hubit://evil/tasks")]
    [InlineData("hubit://user@open/tasks")]
    [InlineData("hubit://open:42/tasks")]
    [InlineData("hubit://open//evil.example")]
    [InlineData("hubit://open/chat%2Fescape")]
    [InlineData("hubit://open/chat%252Fescape")]
    [InlineData("hubit://open/chat?token=secret")]
    [InlineData("hubit://open/login")]
    [InlineData("hubit://open/tasks#fragment")]
    [InlineData("hubit://open/C:/Windows/System32")]
    public void RejectsUntrustedProtocolInput(string input)
    {
        Assert.False(DesktopDeepLinkParser.TryParseProtocolUri(input, out _));
    }

    [Theory]
    [InlineData("/dashboard")]
    [InlineData("/tasks?task=123")]
    [InlineData("/chat?conversation=conv-1&message=msg-2")]
    [InlineData("/networks/branch_1")]
    public void AcceptsAllowlistedInternalRoutes(string input)
    {
        Assert.True(DesktopDeepLinkParser.TryParseInternalRoute(input, out var route));
        Assert.Equal(input, route);
    }

    [Theory]
    [InlineData("//evil.example/tasks")]
    [InlineData("/unknown")]
    [InlineData("/login")]
    [InlineData("/shared-files/secret")]
    [InlineData("/tasks?download_token=secret")]
    [InlineData("/networks/a/b")]
    [InlineData("/tasks\\evil")]
    [InlineData("/tasks\nnext")]
    public void RejectsUnsafeInternalRoutes(string input)
    {
        Assert.False(DesktopDeepLinkParser.TryParseInternalRoute(input, out _));
    }

    [Fact]
    public void RejectsOverlongInput()
    {
        var input = "hubit://open/chat?conversation=" + new string('a', 2048);

        Assert.False(DesktopDeepLinkParser.TryParseProtocolUri(input, out _));
    }

    [Fact]
    public void AcceptsUploadActReminderDeepLinkAndRejectsBlockedKeys()
    {
        // Ссылка задачи напоминания: /database?upload_act=1&reminder_id=…&source_task_id=…
        // — ключи не в блок-листе политики маршрутов.
        var input = "hubit://open/database?upload_act=1&reminder_id=rem-1&source_task_id=901&db_id=it-invent";
        Assert.True(DesktopDeepLinkParser.TryParseProtocolUri(input, out var route));
        Assert.Equal("/database?upload_act=1&reminder_id=rem-1&source_task_id=901&db_id=it-invent", route);

        // Вариант флага upload_act_reminder — тоже маршрут /database.
        Assert.True(DesktopDeepLinkParser.TryParseInternalRoute(
            "/database?upload_act_reminder=rem-2", out var aliasRoute));
        Assert.Equal("/database?upload_act_reminder=rem-2", aliasRoute);

        // Подмена чувствительных ключей по-прежнему отсекается политикой.
        Assert.False(DesktopDeepLinkParser.TryParseInternalRoute(
            "/database?upload_act=1&reminder_id=rem-1&token=abc", out _));
    }

    [Fact]
    public void ParsesUploadActReminderQueryValues()
    {
        // Полный web-формат ссылки напоминания.
        var parsed = Hub.Desktop.Native.Views.HubWindow.TryParseUploadActReminderRoute(
            "/database?upload_act=1&reminder_id=rem-1&source_task_id=901&db_id=x");
        Assert.NotNull(parsed);
        Assert.Equal("rem-1", parsed!.Value.ReminderId);
        Assert.Equal("901", parsed.Value.SourceTaskId);

        // Альтернативный флаг: id напоминания — сам upload_act_reminder.
        var alias = Hub.Desktop.Native.Views.HubWindow.TryParseUploadActReminderRoute(
            "/database?upload_act_reminder=rem-2");
        Assert.NotNull(alias);
        Assert.Equal("rem-2", alias!.Value.ReminderId);
        Assert.Null(alias.Value.SourceTaskId);

        // Нет флага/нет id — маршрут не reminder-загрузка.
        Assert.Null(Hub.Desktop.Native.Views.HubWindow.TryParseUploadActReminderRoute("/database"));
        Assert.Null(Hub.Desktop.Native.Views.HubWindow.TryParseUploadActReminderRoute(
            "/database?reminder_id=rem-1"));
        Assert.Null(Hub.Desktop.Native.Views.HubWindow.TryParseUploadActReminderRoute(
            "/database?upload_act=1"));
    }
}
