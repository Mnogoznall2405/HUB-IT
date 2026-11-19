using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

/// <summary>
/// Страница «Главная»: секция «Требует внимания» — сборка приоритетной
/// очереди из задач/объявлений, дедупликация, счётчики и навигация по клику.
/// Интеграция с шеллом покрыта в NativeHubShellViewModelTests.
/// </summary>
public sealed class NativeDashboardViewModelTests
{
    // ---- Секция «Требует внимания» ----

    [Fact]
    public async Task LoadBuildsAttentionQueueOrderedByKind()
    {
        var overdue = Task(1, "Просроченная", "in_progress", isOverdue: true,
            dueAt: DateTimeOffset.UtcNow.AddDays(-1));
        var review = Task(2, "На проверке", "review");
        var commented = Task(3, "С комментарием", "in_progress", commentsUnread: 2);
        var api = new FakeHubApiClient
        {
            Dashboard = Dashboard(
                summary: new HubDashboardSummary { TasksOverdue = 1, TasksReviewRequired = 1 },
                tasks: [commented, review, Task(4, "Обычная", "new"), overdue],
                announcements:
                [
                    new HubAnnouncement { Id = "n1", Title = "Обязательная", IsAckPending = true },
                    new HubAnnouncement { Id = "n2", Title = "Обычная" },
                ]),
        };
        var model = new DashboardViewModel(api);

        await model.LoadAsync();

        Assert.Equal(
            ["task:1", "task:2", "task:3", "news:n1"],
            model.AttentionItems.Select(r => r.Key).ToArray());
        Assert.Equal("Просроченная", model.AttentionItems[0].Title);
        Assert.StartsWith("Просрочено", model.AttentionItems[0].SecondaryText);
        Assert.Equal("На проверке", model.AttentionItems[1].SecondaryText);
        Assert.Equal("Новых комментариев: 2", model.AttentionItems[2].SecondaryText);
        Assert.Equal("Нужно прочитать и подтвердить", model.AttentionItems[3].SecondaryText);
        // Тон панели красный, когда есть просрочка.
        Assert.Equal("danger", model.AttentionItems[0].Tone);
        Assert.Equal(model.AttentionItems[0].Tone, model.AttentionTone);
        Assert.NotEqual(model.AttentionItems[0].Tone, model.AttentionItems[1].Tone);
        Assert.True(model.HasAttention);
        Assert.False(model.HasAttentionSummaryOnly);
    }

    [Fact]
    public async Task AttentionDedupesTaskAcrossKinds()
    {
        // Задача просрочена и в статусе review — входит один раз, вид overdue сильнее.
        var api = new FakeHubApiClient
        {
            Dashboard = Dashboard(tasks:
            [
                Task(5, "Горит", "review", isOverdue: true, dueAt: DateTimeOffset.UtcNow.AddDays(-2)),
            ]),
        };
        var model = new DashboardViewModel(api);

        await model.LoadAsync();

        var row = Assert.Single(model.AttentionItems);
        Assert.Equal("task:5", row.Key);
        Assert.StartsWith("Просрочено", row.SecondaryText);
    }

    [Fact]
    public async Task AttentionTotalUsesAuthoritativeSummaryCounters()
    {
        // Счётчики сервера полнее выдачи: из 9 просроченных в payload попала одна.
        var api = new FakeHubApiClient
        {
            Dashboard = Dashboard(
                summary: new HubDashboardSummary
                {
                    TasksOverdue = 9,
                    TasksReviewRequired = 2,
                    TasksWithUnreadComments = 4,
                    AnnouncementsAckPending = 3,
                },
                tasks: [Task(1, "Просроченная", "new", isOverdue: true)]),
        };
        var model = new DashboardViewModel(api);

        await model.LoadAsync();

        Assert.Single(model.AttentionItems);
        Assert.Equal(18, model.AttentionTotal);
        Assert.Equal("18", model.AttentionTotalText);
    }

    [Fact]
    public async Task AttentionTotalNeverBelowRowCount()
    {
        // Задача в статусе review может не учитываться в tasks_review_required
        // (сервер считает только свои проверки), но строка уже показывает сигнал.
        var api = new FakeHubApiClient
        {
            Dashboard = Dashboard(tasks: [Task(2, "На проверке", "review")]),
        };
        var model = new DashboardViewModel(api);

        await model.LoadAsync();

        Assert.Single(model.AttentionItems);
        Assert.Equal(1, model.AttentionTotal);
        Assert.True(model.HasAttention);
    }

    [Fact]
    public async Task EmptyDashboardShowsCalmState()
    {
        var api = new FakeHubApiClient { Dashboard = Dashboard() };
        var model = new DashboardViewModel(api);

        await model.LoadAsync();

        Assert.Empty(model.AttentionItems);
        Assert.False(model.HasAttention);
        Assert.False(model.HasAttentionSummaryOnly);
        Assert.Equal("0", model.AttentionTotalText);
    }

    [Fact]
    public async Task SummaryOnlyAttentionRaisesFlagWithoutRows()
    {
        // Сигналы есть, но конкретные объекты не попали в ограниченную выдачу.
        var api = new FakeHubApiClient
        {
            Dashboard = Dashboard(summary: new HubDashboardSummary
            {
                TasksReviewRequired = 3,
                AnnouncementsAckPending = 2,
            }),
        };
        var model = new DashboardViewModel(api);

        await model.LoadAsync();

        Assert.Empty(model.AttentionItems);
        Assert.True(model.HasAttention);
        Assert.True(model.HasAttentionSummaryOnly);
        Assert.Equal("5", model.AttentionTotalText);
    }

    [Fact]
    public async Task AttentionRowsAreCappedAtSix()
    {
        var api = new FakeHubApiClient
        {
            Dashboard = Dashboard(tasks:
                Enumerable.Range(1, 8)
                    .Select(i => Task(i, $"Задача {i}", "new", isOverdue: true))
                    .ToArray()),
        };
        var model = new DashboardViewModel(api);

        await model.LoadAsync();

        Assert.Equal(6, model.AttentionItems.Count);
    }

    // ---- Клики по строкам ----

    [Fact]
    public async Task OpenAttentionItemOnTaskRaisesTaskOpenRequested()
    {
        var api = new FakeHubApiClient
        {
            Dashboard = Dashboard(tasks:
                [Task(7, "Целевая", "new", isOverdue: true)]),
        };
        var model = new DashboardViewModel(api);
        await model.LoadAsync();
        long? openedTaskId = null;
        model.TaskOpenRequested += (_, id) => openedTaskId = id;

        model.OpenAttentionItemCommand.Execute(model.AttentionItems[0]);

        Assert.Equal(7, openedTaskId);
        // Строка переиспользует тот же элемент, что и список «Ближайшие задачи».
        Assert.Same(model.UpcomingTasks[0], model.AttentionItems[0].Task);
    }

    [Fact]
    public async Task OpenAttentionItemOnAnnouncementRaisesNewsOpenRequested()
    {
        var api = new FakeHubApiClient
        {
            Dashboard = Dashboard(announcements:
                [new HubAnnouncement { Id = "n9", Title = "Обязательная", IsAckPending = true }]),
        };
        var model = new DashboardViewModel(api);
        await model.LoadAsync();
        string? openedNewsId = null;
        model.NewsOpenRequested += (_, id) => openedNewsId = id;

        model.OpenAttentionItemCommand.Execute(model.AttentionItems[0]);

        Assert.Equal("n9", openedNewsId);
        // Строка ссылается на ту же запись, что и список новостей дашборда.
        Assert.Same(model.Announcements[0], model.AttentionItems[0].Announcement);
    }

    [Fact]
    public async Task OpenAttentionItemIgnoresForeignParameter()
    {
        var api = new FakeHubApiClient { Dashboard = Dashboard() };
        var model = new DashboardViewModel(api);
        await model.LoadAsync();
        var fired = false;
        model.TaskOpenRequested += (_, _) => fired = true;
        model.NewsOpenRequested += (_, _) => fired = true;

        model.OpenAttentionItemCommand.Execute("строка не та");
        model.OpenAttentionItemCommand.Execute(null);
        model.OpenAttentionItemCommand.Execute(model.StatCards.FirstOrDefault());

        Assert.False(fired);
    }

    // ---- Жизненный цикл ----

    [Fact]
    public async Task ResetClearsAttentionState()
    {
        var api = new FakeHubApiClient
        {
            Dashboard = Dashboard(
                summary: new HubDashboardSummary { TasksOverdue = 2 },
                tasks: [Task(1, "Просроченная", "new", isOverdue: true)]),
        };
        var model = new DashboardViewModel(api);
        await model.LoadAsync();
        Assert.True(model.HasAttention);

        model.Reset();

        Assert.Empty(model.AttentionItems);
        Assert.False(model.HasAttention);
        Assert.False(model.HasAttentionSummaryOnly);
        Assert.Equal("0", model.AttentionTotalText);
    }

    [Fact]
    public async Task UpcomingTasksStaySortedByDueDate()
    {
        var later = Task(1, "Поздняя", "new", dueAt: DateTimeOffset.UtcNow.AddDays(5));
        var sooner = Task(2, "Ранняя", "new", dueAt: DateTimeOffset.UtcNow.AddDays(1));
        var api = new FakeHubApiClient
        {
            Dashboard = Dashboard(tasks: [later, Task(3, "Без срока", "new"), sooner]),
        };
        var model = new DashboardViewModel(api);

        await model.LoadAsync();

        Assert.Equal([2, 1, 3], model.UpcomingTasks.Select(t => t.Id).ToArray());
    }

    private static HubTaskItem Task(
        long id,
        string title,
        string status,
        bool isOverdue = false,
        DateTimeOffset? dueAt = null,
        int commentsUnread = 0) =>
        new()
        {
            Id = id,
            Title = title,
            Status = status,
            IsOverdue = isOverdue,
            DueAt = dueAt,
            CommentsUnread = commentsUnread,
            AssigneeFullName = "Иван Иванов",
        };

    private static HubDashboard Dashboard(
        HubDashboardSummary? summary = null,
        IReadOnlyList<HubTaskItem>? tasks = null,
        IReadOnlyList<HubAnnouncement>? announcements = null) =>
        new()
        {
            GeneratedAt = DateTimeOffset.UtcNow,
            Summary = summary ?? new HubDashboardSummary(),
            MyTasks = new HubTaskListPage
            {
                Items = tasks ?? [],
                Total = tasks?.Count ?? 0,
            },
            Announcements = new HubAnnouncementList
            {
                Items = announcements ?? [],
            },
            AbsencesToday = new HubAbsenceList
            {
                Items = [],
                Count = 0,
            },
        };
}
