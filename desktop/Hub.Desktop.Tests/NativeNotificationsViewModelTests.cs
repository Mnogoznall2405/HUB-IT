using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

/// <summary>
/// Центр уведомлений: лента с курсором since, badge из notifications_unread_total,
/// merge/dedup при refresh, mark-read/read-all с оптимистичным откатом,
/// коалесцирование refresh, reset между сессиями.
/// </summary>
public sealed class NativeNotificationsViewModelTests
{
    [Fact]
    public async Task LoadFillsFeedSortedDescAndBadgeFromCounts()
    {
        var api = new FakeHubApiClient
        {
            NotificationsPoll = new HubNotificationPoll
            {
                // Сервисная лента не гарантирует порядок — VM сортирует по дате.
                Items =
                [
                    Item("n1", "Старое", createdAt: "2026-11-20T09:00:00Z", unread: 0),
                    Item("n3", "Свежее", createdAt: "2026-11-20T11:00:00Z", unread: 1),
                    Item("n2", "Среднее", createdAt: "2026-11-20T10:00:00Z", unread: 1),
                ],
                UnreadCounts = new HubNotificationUnreadCounts { NotificationsUnreadTotal = 120 },
            },
        };
        var model = new NotificationsViewModel(api);

        await model.LoadAsync();

        Assert.Equal(3, model.Items.Count);
        Assert.Equal("n3", model.Items[0].Id);
        Assert.Equal("n2", model.Items[1].Id);
        Assert.Equal("n1", model.Items[2].Id);
        // Badge — серверный notifications_unread_total (не локальный пересчёт).
        Assert.Equal(120, model.UnreadTotal);
        Assert.True(model.HasUnread);
        // Первый запрос без курсора.
        Assert.Null(api.LastNotificationsPollSince);
        Assert.Equal(1, api.NotificationsPollCallCount);
        Assert.False(model.IsEmpty);
        Assert.False(model.HasBannerError);
    }

    [Fact]
    public async Task EmptyFeedAndPollFailureShowStates()
    {
        var api = new FakeHubApiClient();
        var model = new NotificationsViewModel(api);
        await model.LoadAsync();

        Assert.True(model.IsEmpty);
        Assert.Equal(0, model.UnreadTotal);
        Assert.False(model.HasUnread);

        var failing = new FakeHubApiClient
        {
            NotificationsPollException = new HubApiException(
                HubApiErrorKind.Http, "сервер вернул 500"),
        };
        var failingModel = new NotificationsViewModel(failing);
        await failingModel.LoadAsync();

        Assert.True(failingModel.HasBannerError);
        Assert.Contains("500", failingModel.BannerErrorText);
    }

    [Fact]
    public async Task RefreshMergesNewOnTopDedupsAndAdvancesCursor()
    {
        var api = new FakeHubApiClient
        {
            NotificationsPoll = new HubNotificationPoll
            {
                Items =
                [
                    Item("n1", "Первое", createdAt: "2026-11-20T10:00:00Z", unread: 1),
                ],
                UnreadCounts = new HubNotificationUnreadCounts { NotificationsUnreadTotal = 1 },
            },
        };
        var model = new NotificationsViewModel(api);
        await model.LoadAsync();
        Assert.Null(api.LastNotificationsPollSince);

        // Следующий проход: старый n1 (дедуп) + новый n2.
        api.NotificationsPollFactory = (since, _, _) => new HubNotificationPoll
        {
            Items =
            [
                Item("n1", "Первое", createdAt: "2026-11-20T10:00:00Z", unread: 0),
                Item("n2", "Второе", createdAt: "2026-11-20T12:00:00Z", unread: 1),
            ],
            UnreadCounts = new HubNotificationUnreadCounts { NotificationsUnreadTotal = 2 },
        };

        await model.RefreshFromRealtimeAsync();

        Assert.Equal(2, model.Items.Count);
        Assert.Equal("n2", model.Items[0].Id);
        Assert.Equal("n1", model.Items[1].Id);
        Assert.Equal(2, model.UnreadTotal);
        // Второй запрос ушёл с курсором первого прохода (created_at хранится как строка).
        Assert.Equal(2, api.NotificationsPollCallCount);
        Assert.Equal("2026-11-20T10:00:00Z", api.LastNotificationsPollSince);

        // Курсор сдвинулся: третий запрос несёт уже max=12:00.
        await model.RefreshFromRealtimeAsync();
        Assert.Equal("2026-11-20T12:00:00Z", api.LastNotificationsPollSince);
        Assert.Equal(3, api.NotificationsPollCallCount);
    }

    [Fact]
    public async Task PollTickRunsIncrementalPollOnlyAfterLoad()
    {
        var api = new FakeHubApiClient();
        var model = new NotificationsViewModel(api);

        // До первой загрузки тик ничего не делает (нет сессии).
        await model.PollTickAsync(CancellationToken.None);
        Assert.Equal(0, api.NotificationsPollCallCount);

        await model.LoadAsync();
        await model.PollTickAsync(CancellationToken.None);
        Assert.Equal(2, api.NotificationsPollCallCount);
    }

    [Fact]
    public async Task OpenCommandMarksReadPostsRaisesEventAndClosesPanel()
    {
        var item = Item("n1", "Задача назначена", entityType: "task", entityId: "42", unread: 1);
        var api = new FakeHubApiClient
        {
            NotificationsPoll = new HubNotificationPoll
            {
                Items = [item],
                UnreadCounts = new HubNotificationUnreadCounts { NotificationsUnreadTotal = 5 },
            },
        };
        var model = new NotificationsViewModel(api);
        await model.LoadAsync();
        model.IsPanelOpen = true;
        NotificationItemViewModel? opened = null;
        model.OpenRequested += (_, notification) => opened = notification;

        await ((NativeAsyncCommand)model.OpenCommand).ExecuteAsync(model.Items[0]);

        // Оптимистично: локально прочитано, badge уменьшен, панель закрыта.
        Assert.False(model.Items[0].IsUnread);
        Assert.Equal(4, model.UnreadTotal);
        Assert.Same(model.Items[0], opened);
        Assert.False(model.IsPanelOpen);
        Assert.Single(api.NotificationReadMarkedIds);
        Assert.Equal("n1", api.NotificationReadMarkedIds[0]);
    }

    [Fact]
    public async Task MarkReadCommandMarksWithoutOpenEventAndSkipsRead()
    {
        var api = new FakeHubApiClient
        {
            NotificationsPoll = new HubNotificationPoll
            {
                Items =
                [
                    Item("n1", "Непрочитанное", unread: 1),
                    Item("n2", "Прочитанное", unread: 0),
                ],
                UnreadCounts = new HubNotificationUnreadCounts { NotificationsUnreadTotal = 1 },
            },
        };
        var model = new NotificationsViewModel(api);
        await model.LoadAsync();
        var opened = 0;
        model.OpenRequested += (_, _) => opened++;

        await ((NativeAsyncCommand)model.MarkReadCommand).ExecuteAsync(model.Items[0]);
        Assert.False(model.Items[0].IsUnread);
        Assert.Equal(0, model.UnreadTotal);
        Assert.Equal(0, opened);
        Assert.Single(api.NotificationReadMarkedIds);

        // Повторная отметка прочитанного — без вызова API.
        await ((NativeAsyncCommand)model.MarkReadCommand).ExecuteAsync(model.Items[1]);
        Assert.Single(api.NotificationReadMarkedIds);
    }

    [Fact]
    public async Task MarkReadFailureRollsBackUnreadState()
    {
        var api = new FakeHubApiClient
        {
            NotificationsPoll = new HubNotificationPoll
            {
                Items = [Item("n1", "Уведомление", unread: 1)],
                UnreadCounts = new HubNotificationUnreadCounts { NotificationsUnreadTotal = 3 },
            },
            NotificationMarkReadException = new InvalidOperationException("500"),
        };
        var model = new NotificationsViewModel(api);
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.MarkReadCommand).ExecuteAsync(model.Items[0]);

        Assert.True(model.Items[0].IsUnread);
        Assert.Equal(3, model.UnreadTotal);
        Assert.True(model.HasBannerError);
    }

    [Fact]
    public async Task MarkAllReadClearsLocallyPostsAndRollsBackOnFailure()
    {
        var api = new FakeHubApiClient
        {
            NotificationsPoll = new HubNotificationPoll
            {
                Items =
                [
                    Item("n1", "Одно", unread: 1),
                    Item("n2", "Два", unread: 1),
                    Item("n3", "Три", unread: 0),
                ],
                UnreadCounts = new HubNotificationUnreadCounts { NotificationsUnreadTotal = 7 },
            },
        };
        var model = new NotificationsViewModel(api);
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.MarkAllReadCommand).ExecuteAsync(null);

        Assert.All(model.Items, item => Assert.False(item.IsUnread));
        Assert.Equal(0, model.UnreadTotal);
        Assert.False(model.HasUnread);
        Assert.Equal(1, api.NotificationReadAllCallCount);

        // Ошибка read-all: возвращаем непрочитанность и badge.
        var failing = new FakeHubApiClient
        {
            NotificationsPoll = new HubNotificationPoll
            {
                Items = [Item("n9", "Ещё", unread: 1)],
                UnreadCounts = new HubNotificationUnreadCounts { NotificationsUnreadTotal = 4 },
            },
            NotificationReadAllException = new InvalidOperationException("таймаут"),
        };
        var failingModel = new NotificationsViewModel(failing);
        await failingModel.LoadAsync();

        await ((NativeAsyncCommand)failingModel.MarkAllReadCommand).ExecuteAsync(null);

        Assert.True(failingModel.Items[0].IsUnread);
        Assert.Equal(4, failingModel.UnreadTotal);
        Assert.True(failingModel.HasBannerError);
    }

    [Fact]
    public async Task ConcurrentRefreshesCoalesceIntoSingleQueuedPass()
    {
        var gate = new TaskCompletionSource<HubNotificationPoll>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        var api = new FakeHubApiClient
        {
            NotificationsPollHandler = _ => gate.Task,
        };
        var model = new NotificationsViewModel(api);

        var first = model.RefreshFromRealtimeAsync();
        var second = model.RefreshFromRealtimeAsync();
        var third = model.RefreshFromRealtimeAsync();
        Assert.True(api.NotificationsPollCallCount <= 1, "Параллельных poll быть не должно.");

        gate.SetResult(new HubNotificationPoll());
        await Task.WhenAll(first, second, third);

        // Первый проход + один очередной «догоняющий» (не три).
        Assert.Equal(2, api.NotificationsPollCallCount);
    }

    [Fact]
    public async Task ResetClearsStateAndStopsPolling()
    {
        var api = new FakeHubApiClient
        {
            NotificationsPoll = new HubNotificationPoll
            {
                Items = [Item("n1", "Уведомление", createdAt: "2026-11-20T10:00:00Z", unread: 1)],
                UnreadCounts = new HubNotificationUnreadCounts { NotificationsUnreadTotal = 2 },
            },
        };
        var model = new NotificationsViewModel(api);
        await model.LoadAsync();
        model.IsPanelOpen = true; // открытие догоняет ленту — ещё один poll

        model.Reset();

        Assert.Empty(model.Items);
        Assert.Equal(0, model.UnreadTotal);
        Assert.False(model.IsPanelOpen);
        Assert.False(model.HasBannerError);

        // После reset тик таймера молча пропускается — лента не воскресает.
        await model.PollTickAsync(CancellationToken.None);
        Assert.Equal(2, api.NotificationsPollCallCount);

        // Новая сессия: LoadAsync снова запрашивает с нуля (без since).
        await model.LoadAsync();
        Assert.Null(api.LastNotificationsPollSince);
        Assert.Single(model.Items);
    }

    private static HubNotificationItem Item(
        string id, string title,
        string createdAt = "2026-11-20T10:00:00Z",
        int unread = 1,
        string? eventType = "task.assigned",
        string? entityType = "task",
        string? entityId = "1") =>
        new()
        {
            Id = id,
            EventType = eventType,
            Title = title,
            Body = "Текст " + title,
            EntityType = entityType,
            EntityId = entityId,
            CreatedAt = createdAt,
            Unread = unread,
        };
}
