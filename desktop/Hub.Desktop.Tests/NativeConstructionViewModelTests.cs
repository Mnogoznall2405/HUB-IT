using System.Net;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NativeConstructionViewModelTests
{
    private static HubConstructionObjectSummary Summary(
        string objectRef,
        string name,
        string kind = "project",
        bool managed = false,
        string? managedObjectId = null,
        int requestCount = 5,
        int requests30 = 2,
        int posted = 3) =>
        new()
        {
            ObjectRef = objectRef,
            Name = name,
            Kind = kind,
            RequestCount = requestCount,
            RequestsLast30Days = requests30,
            PostedCount = posted,
            LatestRequestAt = "2026-11-10T08:30:00Z",
            LatestRequestNumber = "1С-00142",
            DepartmentNames = ["УМТО"],
            Managed = managed,
            ManagedObjectId = managedObjectId,
            SourceGroups =
            [
                new HubConstructionObjectGroup { GroupRef = "g1", GroupName = "Школа №3" },
            ],
        };

    private static HubConstructionObjectsResponse ObjectsPage(
        params HubConstructionObjectSummary[] items) =>
        new()
        {
            Items = items,
            Summary = new HubConstructionPortfolioTotals
            {
                ProjectCount = items.Length,
                RequestCount = 42,
                RequestsLast30Days = 5,
            },
            AsOf = "2026-11-19T10:00:00Z",
            Cache = new HubConstructionCacheState { State = "fresh" },
            ManagementAvailable = true,
        };

    private static HubConstructionObjectDetail Detail(
        string id,
        string name,
        bool managed = true) =>
        new()
        {
            Id = id,
            Name = name,
            Kind = "project",
            Managed = managed,
            IsActive = true,
            Groups =
            [
                new HubConstructionObjectGroup { GroupRef = "g1", GroupName = "Школа №3" },
                new HubConstructionObjectGroup { GroupRef = "g2", GroupName = "Детский сад" },
            ],
            Team =
            [
                new HubConstructionTeamMember
                {
                    RoleKey = "project_lead",
                    FullName = "Иван Иванов",
                    Position = "Директор",
                    Department = "УМТО",
                },
            ],
            CreatedAt = "2026-01-05T00:00:00Z",
            UpdatedAt = "2026-11-01T00:00:00Z",
        };

    private static HubConstructionRequestItem Request(
        string requestRef,
        string number,
        string stage = "ordered",
        bool overdue = false) =>
        new()
        {
            RequestRef = requestRef,
            RequestNumber = number,
            Date = "2026-11-01T09:00:00Z",
            RequiredDate = "2026-11-20T00:00:00Z",
            DepartmentName = "УМТО",
            ResponsibleName = "Иван Иванов",
            WarehouseName = "ЦО",
            GroupName = "Школа №3",
            Stage = new HubConstructionRequestStage
            {
                Key = stage,
                Label = stage switch
                {
                    "ordered" => "Заказано поставщику",
                    "fulfilled" => "Доставлено на склад",
                    "needs_review" => "Требует проверки",
                    _ => stage,
                },
                Rank = 4,
            },
            CurrentState = new HubConstructionCurrentState
            {
                Label = stage,
                Description = "Заказ PO-77 размещён",
            },
            IsActive = true,
            Overdue = overdue,
            PositionsTotal = 3,
            NomenclatureItems =
            [
                new HubConstructionNomenclatureItem
                {
                    Name = "Кабель ВВГ 3х2.5",
                    Quantity = 12,
                    Unit = "м",
                },
            ],
        };

    private static HubConstructionObjectRequestsResponse RequestsPage(
        params HubConstructionRequestItem[] items) =>
        new()
        {
            Items = items,
            Total = items.Length,
            DirectionStats =
            [
                new HubConstructionDirectionStat
                {
                    GroupRef = "g1",
                    GroupName = "Школа №3",
                    Active = 9,
                    Overdue = 2,
                },
            ],
            Summary = new HubConstructionRequestTotals
            {
                Total = 14,
                Active = 9,
                History = 5,
                Overdue = 2,
            },
        };

    private static async Task WaitFor(Func<bool> condition)
    {
        for (var attempt = 0; attempt < 100; attempt++)
        {
            if (condition())
            {
                return;
            }

            await Task.Delay(20);
        }

        Assert.True(condition(), "Условие не выполнено за отведённое время.");
    }

    // ---- Список объектов ----

    [Fact]
    public async Task LoadFillsPortfolioListAndTotals()
    {
        var api = new FakeHubApiClient
        {
            ConstructionObjects = ObjectsPage(
                Summary("grp-1", "ЖК Северный", managed: true, managedObjectId: "managed:17"),
                Summary("general", "Общехозяйственная деятельность", kind: "general"),
                Summary("unassigned", "Без номенклатурной группы", kind: "unassigned")),
        };
        var model = new ConstructionViewModel(api);

        await model.LoadAsync();

        Assert.Equal(3, model.Items.Count);
        var project = model.Items[0];
        Assert.Equal("grp-1", project.ObjectRef);
        // Как в вебе: detail/requests идут по managed_object_id || object_ref.
        Assert.Equal("managed:17", project.DetailKey);
        Assert.Equal("Объект", project.KindLabel);
        Assert.Equal("info", project.KindTone);
        Assert.Equal("Общий контур", model.Items[1].KindLabel);
        Assert.Equal("Требует разбора", model.Items[2].KindLabel);
        Assert.False(model.IsEmpty);
        Assert.False(model.HasBannerError);
        Assert.Contains("заяв", model.TotalText, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Обновлено", model.LastUpdatedText);
        Assert.Equal("all", api.ConstructionObjectsCalls[^1].Kind);
    }

    [Fact]
    public async Task EmptyPortfolioShowsEmptyState()
    {
        var api = new FakeHubApiClient { ConstructionObjects = ObjectsPage() };
        var model = new ConstructionViewModel(api);

        await model.LoadAsync();

        Assert.True(model.IsEmpty);
        Assert.Empty(model.Items);
    }

    [Fact]
    public async Task SelectingObjectLoadsDetailDirectionsTeamAndRequests()
    {
        var api = new FakeHubApiClient
        {
            ConstructionObjects = ObjectsPage(Summary("grp-1", "ЖК Северный")),
            ConstructionObjectDetail = Detail("grp-1", "ЖК Северный"),
            ConstructionObjectRequests = RequestsPage(
                Request("REQ-1", "1С-00142", stage: "ordered"),
                Request("REQ-2", "1С-00143", stage: "fulfilled", overdue: true)),
        };
        var model = new ConstructionViewModel(api);
        await model.LoadAsync();

        model.SelectedObject = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        Assert.Equal("grp-1", api.ConstructionObjectDetailCalls[^1]);
        var detail = model.Detail!;
        Assert.Equal("ЖК Северный", detail.Title);
        Assert.Equal("Активный", detail.StatusText);
        Assert.True(detail.Managed);
        Assert.Equal(2, detail.Directions.Count);
        // Счётчики direction_stats перекрывают group-счётчики, как на веб-странице.
        Assert.Equal(9, detail.Directions[0].ActiveCount);
        Assert.True(detail.Directions[0].HasOverdue);
        var member = Assert.Single(detail.Team);
        Assert.Equal("Руководитель проекта", member.RoleText);
        Assert.Equal("Иван Иванов", member.FullName);

        Assert.Equal(2, model.Requests.Count);
        var request = model.Requests[0];
        Assert.Equal("1С-00142", request.Title);
        Assert.Equal("Заказано поставщику", request.StageText);
        Assert.Equal("info", request.StageTone);
        Assert.Equal("Заказ PO-77 размещён", request.StateText);
        Assert.Equal("3 позиции", request.PositionsText);
        Assert.Contains("Кабель ВВГ", request.NomenclatureText);
        Assert.True(model.Requests[1].Overdue);
        Assert.Equal("success", model.Requests[1].StageTone);
        Assert.Contains("активных 9", model.RequestsSummaryText);
    }

    [Theory]
    [InlineData("general", "general", "Заявки общего назначения")]
    [InlineData("unassigned", "unassigned", "не заполнена номенклатурная группа")]
    public async Task NonProjectObjectShowsNoticeWithoutDetailOrRequestsCalls(
        string objectRef,
        string kind,
        string noticePart)
    {
        var api = new FakeHubApiClient
        {
            ConstructionObjects = ObjectsPage(
                Summary(objectRef, "Карточка", kind: kind, requestCount: 7)),
        };
        var model = new ConstructionViewModel(api);
        await model.LoadAsync();

        model.SelectedObject = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        Assert.True(model.Detail!.HasNotice);
        Assert.Contains(noticePart, model.Detail.NoticeText, StringComparison.OrdinalIgnoreCase);
        Assert.False(model.Detail.IsProject);
        // Без api-вызовов: у этих контуров нет карточки объекта.
        Assert.Empty(api.ConstructionObjectDetailCalls);
        Assert.Empty(api.ConstructionObjectRequestsCalls);
        Assert.Empty(model.Requests);
        Assert.False(model.ShowRequestsEmpty);
    }

    [Fact]
    public async Task StaleDetailLoadDoesNotOverwriteNewerSelection()
    {
        var api = new FakeHubApiClient
        {
            ConstructionObjects = ObjectsPage(
                Summary("grp-a", "Объект А"),
                Summary("grp-b", "Объект Б")),
            // Первый деталь «зависает» — выбор переключается до ответа.
            ConstructionObjectDetailDelay = (id, ct) =>
                id == "grp-a"
                    ? Task.Delay(Timeout.Infinite, ct)
                    : Task.CompletedTask,
            ConstructionObjectDetailFactory = id => Detail(id, "Карточка " + id, managed: false),
            ConstructionObjectRequests = RequestsPage(Request("REQ-1", "1С-1")),
        };
        var model = new ConstructionViewModel(api);
        await model.LoadAsync();

        model.SelectedObject = model.Items[0];
        await WaitFor(() => api.ConstructionObjectDetailCalls.Count == 1);
        model.SelectedObject = model.Items[1];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        // Отменённая загрузка «А» не перекрыла карточку «Б».
        Assert.Equal("grp-b", api.ConstructionObjectDetailCalls[^1]);
        Assert.Equal("Карточка grp-b", model.Detail!.Title);
        Assert.False(model.HasDetailError);
    }

    [Fact]
    public async Task SearchTextDebouncesIntoServerQuery()
    {
        var api = new FakeHubApiClient
        {
            ConstructionObjects = ObjectsPage(Summary("grp-1", "ЖК Северный")),
        };
        var model = new ConstructionViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        var calls = api.ConstructionObjectsCallCount;

        model.SearchText = "  склад  ";
        await WaitFor(() => api.ConstructionObjectsCallCount > calls);

        Assert.Equal("склад", api.ConstructionObjectsCalls[^1].Search);
    }

    [Fact]
    public async Task StaleSearchDoesNotReachServer()
    {
        var api = new FakeHubApiClient { ConstructionObjects = ObjectsPage() };
        var gate = new TaskCompletionSource();
        var model = new ConstructionViewModel(api)
        {
            DelayAsync = async (_, ct) =>
            {
                await gate.Task;
                ct.ThrowIfCancellationRequested();
            },
        };
        await model.LoadAsync();
        var calls = api.ConstructionObjectsCallCount;

        model.SearchText = "а";
        model.SearchText = "аб";
        gate.SetResult();
        await WaitFor(() => api.ConstructionObjectsCallCount > calls);

        Assert.Equal("аб", api.ConstructionObjectsCalls[^1].Search);
        Assert.DoesNotContain(
            api.ConstructionObjectsCalls,
            call => call.Search == "а");
    }

    [Fact]
    public async Task KindChipReloadsWithKindQueryParam()
    {
        var api = new FakeHubApiClient
        {
            ConstructionObjects = ObjectsPage(Summary("grp-1", "ЖК")),
        };
        var model = new ConstructionViewModel(api);
        await model.LoadAsync();
        var calls = api.ConstructionObjectsCallCount;

        model.SelectKindCommand.Execute("project");
        await WaitFor(() => api.ConstructionObjectsCallCount > calls);

        Assert.Equal("project", api.ConstructionObjectsCalls[^1].Kind);
        Assert.True(model.IsKindProject);
        Assert.False(model.IsKindAll);
    }

    [Fact]
    public async Task LoadErrorGoesToBannerAndRetryRecovers()
    {
        var api = new FakeHubApiClient
        {
            ConstructionObjectsException = new HubApiException(
                HubApiErrorKind.Transport,
                "down"),
        };
        var model = new ConstructionViewModel(api);

        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);

        Assert.True(model.HasBannerError);
        Assert.Contains("соединения", model.BannerErrorText, StringComparison.OrdinalIgnoreCase);
        Assert.False(model.IsLoading);

        api.ConstructionObjectsException = null;
        api.ConstructionObjects = ObjectsPage(Summary("grp-1", "ЖК"));
        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);

        Assert.False(model.HasBannerError);
        Assert.Single(model.Items);
    }

    [Fact]
    public async Task DetailErrorShowsRetryAndRecovers()
    {
        var api = new FakeHubApiClient
        {
            ConstructionObjects = ObjectsPage(Summary("grp-1", "ЖК")),
            ConstructionObjectDetailException = new HubApiException(
                HubApiErrorKind.Http,
                "forbidden",
                HttpStatusCode.Forbidden),
        };
        var model = new ConstructionViewModel(api);
        await model.LoadAsync();

        model.SelectedObject = model.Items[0];
        await WaitFor(() => model.HasDetailError && !model.IsDetailLoading);

        Assert.Null(model.Detail);
        Assert.Contains("Недостаточно прав", model.DetailErrorText, StringComparison.OrdinalIgnoreCase);

        api.ConstructionObjectDetailException = null;
        api.ConstructionObjectDetail = Detail("grp-1", "ЖК");
        api.ConstructionObjectRequests = RequestsPage(Request("REQ-1", "1С-1"));
        await ((NativeAsyncCommand)model.RetryDetailCommand).ExecuteAsync(null);
        await WaitFor(() => model.Detail is not null);

        Assert.False(model.HasDetailError);
        Assert.Equal("ЖК", model.Detail!.Title);
    }

    [Fact]
    public async Task RequestsErrorKeepsDetailAndRetries()
    {
        var api = new FakeHubApiClient
        {
            ConstructionObjects = ObjectsPage(Summary("grp-1", "ЖК")),
            ConstructionObjectDetail = Detail("grp-1", "ЖК"),
            ConstructionObjectRequestsException = new HubApiException(
                HubApiErrorKind.Http,
                "timeout",
                HttpStatusCode.InternalServerError),
        };
        var model = new ConstructionViewModel(api);
        await model.LoadAsync();

        model.SelectedObject = model.Items[0];
        await WaitFor(() => model.HasRequestsError && !model.IsRequestsLoading);

        // Карточка объекта осталась — заявки показывают свою ошибку + «Повторить».
        Assert.NotNull(model.Detail);
        Assert.False(model.HasDetailError);
        Assert.Empty(model.Requests);

        api.ConstructionObjectRequestsException = null;
        api.ConstructionObjectRequests = RequestsPage(Request("REQ-1", "1С-1"));
        await ((NativeAsyncCommand)model.RetryRequestsCommand).ExecuteAsync(null);
        await WaitFor(() => model.Requests.Count == 1);

        Assert.False(model.HasRequestsError);
        Assert.Equal("1С-1", model.Requests[0].Title);
    }

    [Fact]
    public async Task LoadMoreObjectsAppendsNextCursorPage()
    {
        var api = new FakeHubApiClient
        {
            ConstructionObjectsFactory = query => new HubConstructionObjectsResponse
            {
                Items =
                [
                    string.IsNullOrEmpty(query.Cursor)
                        ? Summary("grp-1", "Первая")
                        : Summary("grp-2", "Вторая"),
                ],
                NextCursor = string.IsNullOrEmpty(query.Cursor) ? "cur-2" : null,
                HasMore = string.IsNullOrEmpty(query.Cursor),
            },
        };
        var model = new ConstructionViewModel(api);
        await model.LoadAsync();
        Assert.True(model.HasMore);
        Assert.Single(model.Items);

        await ((NativeAsyncCommand)model.LoadMoreCommand).ExecuteAsync(null);

        Assert.Equal(2, model.Items.Count);
        Assert.Equal("cur-2", api.ConstructionObjectsCalls[^1].Cursor);
        Assert.False(model.HasMore);
    }

    [Fact]
    public async Task LoadMoreRequestsAppendsNextPage()
    {
        var api = new FakeHubApiClient
        {
            ConstructionObjects = ObjectsPage(Summary("grp-1", "ЖК")),
            ConstructionObjectDetail = Detail("grp-1", "ЖК"),
            // «Показать ещё» — догрузка следующей страницы по next_cursor, как в вебе.
            ConstructionObjectRequestsFactory = (_, query) =>
                string.IsNullOrEmpty(query.Cursor)
                    ? new HubConstructionObjectRequestsResponse
                    {
                        Items = [Request("REQ-1", "1С-1")],
                        NextCursor = "rcur-1",
                        HasMore = true,
                    }
                    : new HubConstructionObjectRequestsResponse
                    {
                        Items = [Request("REQ-2", "1С-201")],
                        HasMore = false,
                    },
        };
        var model = new ConstructionViewModel(api);
        await model.LoadAsync();
        model.SelectedObject = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);
        Assert.Single(model.Requests);
        Assert.True(model.HasMoreRequests);

        await ((NativeAsyncCommand)model.LoadMoreRequestsCommand).ExecuteAsync(null);
        await WaitFor(() => model.Requests.Count == 2);

        Assert.Equal("rcur-1", api.ConstructionObjectRequestsCalls[^1].Query.Cursor);
        Assert.Equal("1С-201", model.Requests[1].Title);
        Assert.False(model.HasMoreRequests);
    }

    [Fact]
    public async Task RefreshKeepsSelectionAndReloadsDetail()
    {
        var api = new FakeHubApiClient
        {
            ConstructionObjects = ObjectsPage(Summary("grp-1", "ЖК")),
            ConstructionObjectDetail = Detail("grp-1", "ЖК"),
            ConstructionObjectRequests = RequestsPage(Request("REQ-1", "1С-1")),
        };
        var model = new ConstructionViewModel(api);
        await model.LoadAsync();
        model.SelectedObject = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);
        var detailCalls = api.ConstructionObjectDetailCalls.Count;

        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);
        await WaitFor(() => api.ConstructionObjectDetailCalls.Count > detailCalls);

        Assert.Same(model.Items[0], model.SelectedObject);
        Assert.True(api.ConstructionObjectsCalls[^1].Refresh);
    }

    [Fact]
    public async Task ResetClearsListDetailAndFilters()
    {
        var api = new FakeHubApiClient
        {
            ConstructionObjects = ObjectsPage(Summary("grp-1", "ЖК")),
            ConstructionObjectDetail = Detail("grp-1", "ЖК"),
            ConstructionObjectRequests = RequestsPage(Request("REQ-1", "1С-1")),
        };
        var model = new ConstructionViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        model.SelectedObject = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);
        model.SearchText = "x";
        await WaitFor(() => api.ConstructionObjectsCalls[^1].Search == "x");

        model.Reset();

        Assert.Empty(model.Items);
        Assert.Empty(model.Requests);
        Assert.Null(model.Detail);
        Assert.Null(model.SelectedObject);
        Assert.Equal(string.Empty, model.SearchText);
        Assert.True(model.IsKindAll);
        Assert.False(model.HasBannerError);
        Assert.False(model.HasDetailError);
    }
}
