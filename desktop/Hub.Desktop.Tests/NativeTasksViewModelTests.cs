using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NativeTasksViewModelTests
{
    // ---- Список: загрузка и состояния ----

    [Fact]
    public async Task LoadPopulatesItemsAndStatusBar()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage
            {
                Total = 2,
                Items = [TaskItem(1, "Первая"), TaskItem(2, "Вторая")],
            },
        };
        var model = new TasksViewModel(api);

        await model.LoadTasksAsync();

        Assert.Equal(2, model.Items.Count);
        Assert.Equal("Первая", model.Items[0].Title);
        Assert.Equal("2", model.TotalText);
        Assert.False(model.HasBannerError);
        Assert.False(model.IsEmpty);
        Assert.Contains("Обновлено", model.LastUpdatedText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task LoadFailureShowsBannerInsteadOfEmptyState()
    {
        var api = new FakeHubApiClient
        {
            TasksException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new TasksViewModel(api);

        // Ошибки маппятся в баннер обработчиком команды, не самой загрузкой.
        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);

        Assert.True(model.HasBannerError);
        Assert.Contains("соединения", model.BannerErrorText!, StringComparison.OrdinalIgnoreCase);
        Assert.False(model.IsEmpty);
    }

    [Fact]
    public async Task OverdueFilterQueriesByDueStateNotStatus()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage { Items = [] },
        };
        var model = new TasksViewModel(api);

        await ((NativeAsyncCommand)model.SelectFilterCommand).ExecuteAsync("overdue");

        Assert.Null(api.LastQuery?.Status);
        Assert.Equal("overdue", api.LastQuery?.DueState);
        Assert.Equal("due_at", api.LastQuery?.SortBy);
        Assert.True(model.IsFilterOverdue);
    }

    // ---- Приоритет: отображение в элементе списка ----

    [Theory]
    [InlineData("critical", "Критичный")]
    [InlineData("urgent", "Срочный")]
    [InlineData("high", "Высокий")]
    [InlineData("medium", "Средний")]
    [InlineData("normal", "Средний")]
    [InlineData("low", "Низкий")]
    [InlineData(null, "")]
    public void ListItemFormatsPriorityLabel(string? priority, string expected)
    {
        var item = new TaskListItemViewModel(TaskItem(1, "Задача", priority: priority));

        Assert.Equal(expected, item.PriorityText);
    }

    [Theory]
    [InlineData("critical", true)]
    [InlineData("urgent", true)]
    [InlineData("high", true)]
    [InlineData("low", true)]
    [InlineData("normal", false)]
    [InlineData("medium", false)]
    [InlineData(null, false)]
    public void ListItemShowsPriorityMarkerOnlyForNonBaseline(string? priority, bool expected)
    {
        var item = new TaskListItemViewModel(TaskItem(1, "Задача", priority: priority));

        Assert.Equal(expected, item.ShowPriority);
    }

    [Fact]
    public void ListItemPriorityToneMatchesSeverity()
    {
        var critical = new TaskListItemViewModel(TaskItem(1, "a", priority: "critical"));
        var urgent = new TaskListItemViewModel(TaskItem(2, "b", priority: "urgent"));
        var high = new TaskListItemViewModel(TaskItem(3, "c", priority: "high"));
        var low = new TaskListItemViewModel(TaskItem(4, "d", priority: "low"));

        // Тон — строковый контракт с разметкой (DataTrigger в HubTheme.xaml).
        Assert.Equal("danger", critical.PriorityTone);
        Assert.Equal("danger", urgent.PriorityTone);
        Assert.Equal("warning", high.PriorityTone);
        Assert.Equal("muted", low.PriorityTone);
    }

    // ---- Приоритет: детальная панель ----

    [Fact]
    public void DetailShowsPriorityFromApiPayload()
    {
        var detail = new TaskDetailViewModel(Detail(5, priority: "high"));

        Assert.True(detail.HasPriority);
        Assert.Equal("Высокий", detail.PriorityText);
        Assert.Equal("warning", detail.PriorityTone);
    }

    [Fact]
    public void DetailHidesPriorityWhenAbsent()
    {
        var detail = new TaskDetailViewModel(Detail(5, priority: null));

        Assert.False(detail.HasPriority);
        Assert.Equal(string.Empty, detail.PriorityText);
    }

    [Fact]
    public void DetailUpdateRefreshesPriority()
    {
        var detail = new TaskDetailViewModel(Detail(5, priority: "normal"));

        detail.Update(Detail(5, priority: "critical"));

        Assert.Equal("Критичный", detail.PriorityText);
        Assert.Equal("danger", detail.PriorityTone);
    }

    // ---- Сквозной сценарий: список -> выбор -> детали ----

    [Fact]
    public async Task SelectingTaskLoadsPriorityIntoDetailPanel()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage
            {
                Total = 1,
                Items = [TaskItem(7, "Срочная задача", priority: "urgent")],
            },
            TaskDetail = Detail(7, priority: "urgent"),
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();

        Assert.True(model.Items[0].ShowPriority);
        Assert.Equal("Срочный", model.Items[0].PriorityText);

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null);

        Assert.Equal("Срочный", model.Detail!.PriorityText);
        Assert.True(model.Detail.HasPriority);
    }

    [Fact]
    public async Task TransitionUpdatesStatusInDetailAndList()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage
            {
                Total = 1,
                Items = [TaskItem(7, "Задача", status: "new")],
            },
            TaskDetail = Detail(7, status: "new", canStart: true),
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null);

        await ((NativeAsyncCommand)model.TransitionCommand).ExecuteAsync("Start");

        Assert.Equal(HubTaskTransition.Start, api.LastTransition);
        Assert.Equal("В работе", model.Detail!.StatusText);
        await WaitFor(() => model.Items.Count > 0 && model.Items[0].StatusText == "В работе");
    }

    private static HubTaskItem TaskItem(
        long id,
        string title,
        string? status = "new",
        string? priority = null) =>
        new()
        {
            Id = id,
            Title = title,
            Status = status,
            Priority = priority,
        };

    private static HubTaskDetail Detail(
        long id,
        string? status = "in_progress",
        string? priority = null,
        bool canStart = false) =>
        new()
        {
            Id = id,
            Title = "Задача",
            Status = status,
            Priority = priority,
            Capabilities = new HubTaskCapabilities { CanStart = canStart },
        };

    private static async Task WaitFor(Func<bool> condition, TimeSpan? timeout = null)
    {
        var limit = timeout ?? TimeSpan.FromSeconds(3);
        var elapsed = TimeSpan.Zero;
        var step = TimeSpan.FromMilliseconds(20);
        while (elapsed < limit)
        {
            if (condition())
            {
                return;
            }

            await Task.Delay(step);
            elapsed += step;
        }

        Assert.True(condition(), "Условие не выполнено за отведённое время.");
    }
}
