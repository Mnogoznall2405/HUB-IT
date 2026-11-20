using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NativeTaskAnalyticsViewModelTests
{
    // ---- Пресеты и диапазон дат ----

    [Theory]
    [InlineData("7d", 6)]
    [InlineData("30d", 29)]
    [InlineData("90d", 89)]
    public void PresetRangeIsInclusiveLikeWeb(string preset, int daysBack)
    {
        var today = new DateTime(2025, 6, 15);

        var (start, end) = TaskAnalyticsViewModel.BuildRangeFromPreset(preset, today);

        // Веб-семантика: «N дней» = сегодня + (N−1) день назад.
        Assert.Equal("2025-06-15", end);
        Assert.Equal(today.AddDays(-daysBack).ToString("yyyy-MM-dd"), start);
    }

    [Fact]
    public async Task ActivateLoadsDirectoriesAndSendsDefaultParams()
    {
        var api = new FakeHubApiClient
        {
            TaskProjects = new HubTaskProjectList
            {
                Items =
                [
                    new HubTaskProject { Id = "p-1", Name = "Проект А", Code = "PA", IsActive = true },
                    new HubTaskProject { Id = "p-0", Name = "Архив", IsActive = false },
                ],
            },
            TaskObjects = new HubTaskObjectList
            {
                Items = [new HubTaskObject { Id = "o-1", ProjectId = "p-1", Name = "Насосная", IsActive = true }],
            },
            TaskAssignees = new HubTaskUserList
            {
                Items = [new HubTaskUserItem { Id = 11, FullName = "Иванов И.И.", Department = "ИТ" }],
            },
            TaskAnalyticsPayload = Payload(total: 4),
        };
        var model = new TaskAnalyticsViewModel(api);

        await model.ActivateAsync();

        // Справочники — один раз; неактивный проект отфильтрован.
        var project = Assert.Single(model.ProjectOptions);
        Assert.Equal("p-1", project.Id);
        Assert.Contains("Проект А", project.Title, StringComparison.Ordinal);
        Assert.Equal("o-1", Assert.Single(model.ObjectOptions).Id);
        Assert.Equal("11", Assert.Single(model.ParticipantOptions).Id);
        Assert.Equal(1, api.TaskProjectsCallCount);
        Assert.Equal(1, api.TaskObjectsCallCount);
        var assigneeSearch = Assert.Single(api.TaskAssigneeSearchCalls);
        Assert.Null(assigneeSearch.Query);
        Assert.Equal(TaskAnalyticsViewModel.ParticipantsLimit, assigneeSearch.Limit);

        // Первый отчёт — дефолтный пресет 30d и date_basis protocol_date.
        var query = Assert.Single(api.TaskAnalyticsCalls);
        Assert.Equal(TaskAnalyticsViewModel.DefaultDateBasis, query.DateBasis);
        Assert.Equal(DateTime.Today.ToString("yyyy-MM-dd"), query.EndDate);
        Assert.Equal(DateTime.Today.AddDays(-29).ToString("yyyy-MM-dd"), query.StartDate);
        Assert.True(model.HasPayload);
        Assert.False(model.HasError);
    }

    // ---- KPI и разрезы ----

    [Fact]
    public async Task PayloadMapsKpisBreakdownsAndTrend()
    {
        var api = new FakeHubApiClient { TaskAnalyticsPayload = Payload(total: 10) };
        var model = new TaskAnalyticsViewModel(api);

        await model.LoadAsync();

        // Шесть KPI-карточек в порядке веб-отчёта.
        Assert.Equal(6, model.Kpis.Count);
        Assert.Equal("Всего задач", model.Kpis[0].Title);
        Assert.Equal("10", model.Kpis[0].Value);
        Assert.Equal("Открыто", model.Kpis[1].Title);
        Assert.Equal("6", model.Kpis[1].Value);
        Assert.Equal("Выполнено", model.Kpis[2].Title);
        // «count / percent%» — разделитель зависит от культуры, проверяем состав.
        Assert.StartsWith("4 /", model.Kpis[2].Value, StringComparison.Ordinal);
        Assert.Contains("40", model.Kpis[2].Value, StringComparison.Ordinal);
        Assert.EndsWith("%", model.Kpis[2].Value, StringComparison.Ordinal);
        Assert.Equal("В срок", model.Kpis[3].Title);
        Assert.StartsWith("3 /", model.Kpis[3].Value, StringComparison.Ordinal);
        Assert.Contains("50", model.Kpis[3].Value, StringComparison.Ordinal);
        Assert.Equal("Просрочено", model.Kpis[4].Title);
        Assert.Equal("2", model.Kpis[4].Value);
        Assert.Equal("Выполнено без срока", model.Kpis[5].Title);

        // Разрезы: имя + счёт + полоска (доля от максимума секции).
        Assert.Equal(4, model.StatusRows.Count);
        Assert.Equal("Новые", model.StatusRows[0].Title);
        Assert.Equal(2, model.StatusRows[0].Value);
        var participant = Assert.Single(model.ParticipantRows);
        Assert.Equal("Иванов И.И.", participant.Title);
        Assert.Equal(10, participant.Value);
        Assert.Equal(100, participant.Percent);
        Assert.Contains("Открыто", participant.MetaText, StringComparison.Ordinal);
        Assert.Equal("Проект А", Assert.Single(model.ProjectRows).Title);
        Assert.Equal("Насосная", Assert.Single(model.ObjectRows).Title);

        // Динамика: «дата — создано/завершено/в срок».
        var trend = Assert.Single(model.TrendItems);
        Assert.Equal("01.01", trend.Label);
        Assert.Equal(2, trend.Created);
        Assert.Equal(1, trend.CompletedOnTime);
        Assert.Equal("по дням", model.TrendGranularityText);
    }

    [Fact]
    public async Task EmptySummaryFallsBackToStatusBreakdownFromSummary()
    {
        var api = new FakeHubApiClient
        {
            TaskAnalyticsPayload = new HubTaskAnalyticsPayload
            {
                Summary = new HubTaskAnalyticsMetrics { Total = 3, New = 2, Done = 1, Open = 2 },
                StatusBreakdown = [],
            },
        };
        var model = new TaskAnalyticsViewModel(api);

        await model.LoadAsync();

        // Без status_breakdown секция строится из summary (фолбэк веб-страницы).
        Assert.Equal(4, model.StatusRows.Count);
        Assert.Equal("Новые", model.StatusRows[0].Title);
        Assert.Equal(2, model.StatusRows[0].Value);
        Assert.Equal("Выполнено", model.StatusRows[3].Title);
        Assert.False(model.IsEmpty);
    }

    [Fact]
    public async Task ZeroTotalShowsEmptyState()
    {
        var api = new FakeHubApiClient
        {
            TaskAnalyticsPayload = new HubTaskAnalyticsPayload
            {
                Summary = new HubTaskAnalyticsMetrics(),
            },
        };
        var model = new TaskAnalyticsViewModel(api);

        await model.LoadAsync();

        Assert.True(model.IsEmpty);
        Assert.True(model.HasPayload);
    }

    // ---- Фильтры: чипы и параметры запроса ----

    [Fact]
    public async Task FilterChipsMapIntoQueryListsAndDedupeKey()
    {
        var api = new FakeHubApiClient { TaskAnalyticsPayload = Payload(total: 1) };
        var model = new TaskAnalyticsViewModel(api);
        model.SelectedProjects.Add(new TaskAnalyticsFilterOption("project", "p-1", "Проект А"));
        model.SelectedObjects.Add(new TaskAnalyticsFilterOption("object", "o-1", "Насосная"));
        model.SelectedParticipants.Add(new TaskAnalyticsFilterOption("participant", "11", "Иванов"));

        await model.LoadAsync();

        var query = Assert.Single(api.TaskAnalyticsCalls);
        Assert.Equal(["p-1"], query.ProjectIds ?? []);
        Assert.Equal(["o-1"], query.ObjectIds ?? []);
        Assert.Equal([11L], query.ParticipantUserIds ?? []);

        // Тот же набор параметров — повторная загрузка не уходит.
        await model.LoadAsync();
        Assert.Single(api.TaskAnalyticsCalls);
    }

    [Fact]
    public void CandidateSelectionAddsChipAndRemoveDropsIt()
    {
        var api = new FakeHubApiClient { TaskAnalyticsPayload = Payload(total: 1) };
        var model = new TaskAnalyticsViewModel(api);
        var option = new TaskAnalyticsFilterOption("project", "p-1", "Проект А");

        model.SelectedProjectCandidate = option;

        Assert.Null(model.SelectedProjectCandidate); // поле очищается — чип живёт в списке
        Assert.True(model.HasSelectedProjects);
        Assert.Equal("p-1", Assert.Single(model.SelectedProjects).Id);

        model.RemoveFilterCommand.Execute(option);
        Assert.Empty(model.SelectedProjects);
        Assert.False(model.HasSelectedProjects);
    }

    // ---- Dedupe / свежесть ----

    [Fact]
    public async Task SameParamsKeyLoadsOnlyOnceUntilForced()
    {
        var api = new FakeHubApiClient { TaskAnalyticsPayload = Payload(total: 1) };
        var model = new TaskAnalyticsViewModel(api);

        await model.LoadAsync();
        await model.LoadAsync();
        await model.LoadAsync(force: false);
        Assert.Single(api.TaskAnalyticsCalls);

        await model.LoadAsync(force: true);
        Assert.Equal(2, api.TaskAnalyticsCalls.Count);
    }

    [Fact]
    public async Task ChangedParamsProduceNewRequest()
    {
        var api = new FakeHubApiClient { TaskAnalyticsPayload = Payload(total: 1) };
        var model = new TaskAnalyticsViewModel(api);

        await model.LoadAsync();
        model.SelectedProjects.Add(new TaskAnalyticsFilterOption("project", "p-1", "Проект А"));
        await model.LoadAsync();

        Assert.Equal(2, api.TaskAnalyticsCalls.Count);
        Assert.Equal(["p-1"], api.TaskAnalyticsCalls[1].ProjectIds ?? []);
    }

    [Fact]
    public async Task InFlightRequestIsNotDuplicatedForSameKey()
    {
        var gate = new TaskCompletionSource<HubTaskAnalyticsPayload>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        var api = new FakeHubApiClient
        {
            TaskAnalyticsHandler = (_, _) => gate.Task,
        };
        var model = new TaskAnalyticsViewModel(api);

        var first = model.LoadAsync();
        var second = model.LoadAsync();
        await second;

        Assert.Single(api.TaskAnalyticsCalls);
        gate.SetResult(Payload(total: 1));
        await first;
        Assert.True(model.HasPayload);
    }

    [Fact]
    public async Task StaleResponseDoesNotOverwriteNewerParams()
    {
        var slow = new TaskCompletionSource<HubTaskAnalyticsPayload>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        var api = new FakeHubApiClient
        {
            // Первый запрос (без фильтров) зависает; второй (с фильтром) — мгновенный.
            TaskAnalyticsHandler = (query, _) =>
                query.ProjectIds?.Count > 0
                    ? Task.FromResult(Payload(total: 5))
                    : slow.Task,
        };
        var model = new TaskAnalyticsViewModel(api);

        var staleLoad = model.LoadAsync();
        model.SelectedProjects.Add(new TaskAnalyticsFilterOption("project", "p-1", "Проект А"));
        await model.LoadAsync();
        Assert.Equal("5", model.Kpis[0].Value);

        // Устаревший ответ приходит позже — свежие данные не перетираются.
        slow.SetResult(Payload(total: 99));
        await staleLoad;
        Assert.Equal("5", model.Kpis[0].Value);
    }

    // ---- Ошибка и повтор ----

    [Fact]
    public async Task LoadErrorShowsBannerAndRetryRecovers()
    {
        var api = new FakeHubApiClient
        {
            TaskAnalyticsException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new TaskAnalyticsViewModel(api);

        await model.ActivateAsync();
        Assert.True(model.HasError);
        Assert.False(model.HasPayload);

        api.TaskAnalyticsException = null;
        api.TaskAnalyticsPayload = Payload(total: 2);
        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);

        Assert.False(model.HasError);
        Assert.True(model.HasPayload);
        Assert.Equal("2", model.Kpis[0].Value);
    }

    // ---- Экспорт ----

    [Fact]
    public async Task ExportStreamsThroughPickerAndUsesServerFileName()
    {
        var api = new FakeHubApiClient
        {
            TaskAnalyticsPayload = Payload(total: 1),
            TaskAnalyticsExportBytes = [9, 8, 7],
            TaskAnalyticsExportFileName = "server-report.xlsx",
        };
        var model = new TaskAnalyticsViewModel(api);
        await model.LoadAsync();

        var directory = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var target = Path.Combine(directory, "out.xlsx");
            var pickedSuggestion = string.Empty;
            model.ExportTargetPicker = suggested =>
            {
                pickedSuggestion = suggested;
                return target;
            };

            await ((NativeAsyncCommand)model.ExportCommand).ExecuteAsync(null);

            Assert.EndsWith(".xlsx", pickedSuggestion, StringComparison.Ordinal);
            var query = Assert.Single(api.TaskAnalyticsExportCalls);
            Assert.Equal(TaskAnalyticsViewModel.DefaultDateBasis, query.DateBasis);
            // Файл переименован в имя из Content-Disposition.
            var saved = Path.Combine(directory, "server-report.xlsx");
            Assert.True(File.Exists(saved));
            Assert.Equal(api.TaskAnalyticsExportBytes, await File.ReadAllBytesAsync(saved));
            Assert.False(File.Exists(target));
            Assert.Contains("server-report.xlsx", model.StatusText ?? string.Empty, StringComparison.Ordinal);
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public async Task ExportCancelledByPickerSkipsRequest()
    {
        var api = new FakeHubApiClient { TaskAnalyticsPayload = Payload(total: 1) };
        var model = new TaskAnalyticsViewModel(api);
        await model.LoadAsync();
        model.ExportTargetPicker = _ => null;

        await ((NativeAsyncCommand)model.ExportCommand).ExecuteAsync(null);

        Assert.Empty(api.TaskAnalyticsExportCalls);
        Assert.False(model.IsExporting);
    }

    // ---- Переключатель режимов страницы ----

    [Fact]
    public void ViewModeSwitchTogglesListAndAnalytics()
    {
        var model = new TasksViewModel(new FakeHubApiClient());

        Assert.True(model.IsListMode);
        Assert.False(model.IsAnalyticsMode);

        model.SelectViewModeCommand.Execute("analytics");
        Assert.Equal("analytics", model.ViewMode);
        Assert.True(model.IsAnalyticsMode);
        Assert.False(model.IsListMode);

        model.SelectViewModeCommand.Execute("list");
        Assert.True(model.IsListMode);
    }

    [Fact]
    public void ResetReturnsToListModeAndClearsAnalytics()
    {
        var api = new FakeHubApiClient();
        var model = new TasksViewModel(api);
        model.SelectViewModeCommand.Execute("analytics");
        model.Analytics.SelectedProjects.Add(
            new TaskAnalyticsFilterOption("project", "p-1", "Проект А"));

        model.Reset();

        Assert.True(model.IsListMode);
        Assert.Empty(model.Analytics.SelectedProjects);
        Assert.False(model.Analytics.HasPayload);
    }

    private static HubTaskAnalyticsPayload Payload(int total) => new()
    {
        Summary = new HubTaskAnalyticsMetrics
        {
            Total = total,
            New = 2,
            InProgress = 3,
            Review = 1,
            Done = 4,
            Open = 6,
            DoneOnTime = 3,
            DoneWithoutDue = 1,
            Overdue = 2,
            WithDueTotal = 6,
            CompletionPercent = 40.0,
            CompletionOnTimePercent = 50.0,
        },
        StatusBreakdown =
        [
            new HubTaskAnalyticsStatusItem { Status = "new", Label = "Новые", Value = 2 },
            new HubTaskAnalyticsStatusItem { Status = "in_progress", Label = "В работе", Value = 3 },
            new HubTaskAnalyticsStatusItem { Status = "review", Label = "На проверке", Value = 1 },
            new HubTaskAnalyticsStatusItem { Status = "done", Label = "Выполнено", Value = 4 },
        ],
        ByParticipant =
        [
            new HubTaskAnalyticsParticipant
            {
                ParticipantUserId = 11,
                ParticipantName = "Иванов И.И.",
                Total = 10,
                Open = 6,
                Done = 4,
                Overdue = 2,
            },
        ],
        ByProject =
        [
            new HubTaskAnalyticsProject
            {
                ProjectId = "p-1",
                ProjectName = "Проект А",
                Total = 10,
                Open = 6,
                Done = 4,
            },
        ],
        ByObject =
        [
            new HubTaskAnalyticsObject
            {
                ObjectId = "o-1",
                ObjectName = "Насосная",
                Total = 7,
                Open = 5,
                Done = 2,
            },
        ],
        Trend = new HubTaskAnalyticsTrend
        {
            Granularity = "day",
            Items =
            [
                new HubTaskAnalyticsTrendItem
                {
                    BucketKey = "2025-01-01",
                    BucketLabel = "01.01",
                    Created = 2,
                    Completed = 1,
                    CompletedOnTime = 1,
                },
            ],
        },
    };
}
