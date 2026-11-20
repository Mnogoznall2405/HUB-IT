using System.Net;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NativeItRequestsViewModelTests
{
    private static HubItRequestItem Request(
        string requestRef = "req-1",
        string number = "000-ИТ-42",
        string stage = "ordered",
        bool overdue = false) =>
        new()
        {
            RequestRef = requestRef,
            RequestNumber = number,
            Date = "2026-11-05T09:00:00Z",
            RequiredDate = "2026-11-25T00:00:00Z",
            DepartmentName = "ИТ",
            InitiatorName = "Иван Иванов",
            ResponsibleName = "Пётр Петров",
            WarehouseRef = "wh-1",
            WarehouseName = "Склад ИТ",
            Stage = new HubItRequestStage
            {
                Key = stage,
                Label = stage switch
                {
                    "ordered" => "Заказана",
                    "fulfilled" => "Выполнена",
                    "created" => "Создана",
                    _ => stage,
                },
                Rank = 2,
            },
            CurrentState = new HubItRequestCurrentState
            {
                Label = stage,
                Description = "Заказ у поставщика",
            },
            IsActive = stage != "fulfilled",
            StatusGroup = "active",
            Overdue = overdue,
            AttentionRequired = overdue,
            PositionsTotal = 2,
            ProgressLabel = "2 позиции в заявке",
            NomenclatureItems =
            [
                new HubItRequestNomenclaturePreview { Name = "SSD 1TB", Quantity = 4, Unit = "шт" },
            ],
            ManagerNames = ["Пётр Петров"],
            SupplierNames = ["ООО Снаб"],
        };

    private static HubItRequestItem Detail(string requestRef = "req-1") =>
        new()
        {
            RequestRef = requestRef,
            RequestNumber = "000-ИТ-42",
            Date = "2026-11-05T09:00:00Z",
            RequiredDate = "2026-11-25T00:00:00Z",
            DepartmentName = "ИТ",
            InitiatorName = "Иван Иванов",
            ResponsibleName = "Пётр Петров",
            WarehouseName = "Склад ИТ",
            Stage = new HubItRequestStage { Key = "ordered", Label = "Заказана", Rank = 2 },
            CurrentState = new HubItRequestCurrentState
            {
                Label = "Заказана",
                Description = "Заказ размещён у поставщика ООО Снаб",
            },
            Comment = "Для серверной",
            SupplierNames = ["ООО Снаб"],
            ManagerNames = ["Пётр Петров"],
            ProgressLabel = "2 позиции в заявке",
            Journey =
            [
                new HubItRequestJourneyStep
                {
                    Key = "created",
                    Label = "Заявка",
                    Reached = true,
                    Date = "2026-11-05T09:00:00Z",
                    DocumentNumber = "000-ИТ-42",
                },
                new HubItRequestJourneyStep
                {
                    Key = "assigned",
                    Label = "Закупщик",
                    Reached = true,
                    Current = true,
                    Date = "2026-11-06T09:00:00Z",
                },
                new HubItRequestJourneyStep { Key = "ordered", Label = "Заказ", Reached = false },
            ],
            ItemGroups =
            [
                new HubItRequestItemGroup
                {
                    Name = "SSD 1TB",
                    Unit = "шт",
                    Quantity = 4,
                    QtyRequested = 4,
                    QtyOrdered = 4,
                },
            ],
            Timeline =
            [
                new HubItRequestTimelineEvent
                {
                    Type = "ordered",
                    Label = "Заказ поставщику",
                    DocumentNumber = "PO-9",
                    Date = "2026-11-07T00:00:00Z",
                    Quantity = 4,
                    SupplierName = "ООО Снаб",
                    NomenclatureNames = ["SSD 1TB"],
                },
            ],
        };

    private static HubItRequestsResponse Page(params HubItRequestItem[] items) =>
        new()
        {
            Items = items,
            Total = items.Length,
            AsOf = "2026-11-19T10:00:00Z",
            SnapshotId = "snap-1",
            WarehouseFacets =
            [
                new HubWarehouse1cCatalogItem
                {
                    Ref = "wh-1",
                    Name = "Склад ИТ",
                    Count = 3,
                    OverdueCount = 1,
                },
            ],
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

    // ---- Список ----

    [Fact]
    public async Task LoadFillsListFacetsAndAsOf()
    {
        var api = new FakeHubApiClient
        {
            Warehouse1cItRequests = Page(
                Request("req-1", "000-ИТ-42", overdue: true),
                Request("req-2", "000-ИТ-43", stage: "created")),
        };
        var model = new ItRequestsViewModel(api);

        await model.LoadAsync(CancellationToken.None);

        Assert.Equal(2, model.Items.Count);
        var first = model.Items[0];
        Assert.Equal("000-ИТ-42", first.Number);
        Assert.True(first.Overdue);
        Assert.Equal("danger", first.StateTone);
        Assert.Equal("Склад ИТ", first.WarehouseName);
        Assert.Contains("SSD", first.NomenclaturePreview);
        Assert.Contains("Заявок: 2", model.ResultText);
        Assert.Contains("По состоянию на", model.AsOfText);
        // Фасет склада: «все» + один реальный.
        Assert.Equal(2, model.WarehouseFacets.Count);
        Assert.Contains("просрочено", model.WarehouseFacets[1].Text);
        Assert.Equal("active", api.Warehouse1cItRequestsCalls[^1].View);
        Assert.True(model.Searched);
    }

    [Fact]
    public async Task EmptyListShowsEmptyState()
    {
        var api = new FakeHubApiClient { Warehouse1cItRequests = Page() };
        var model = new ItRequestsViewModel(api);

        await model.LoadAsync(CancellationToken.None);

        Assert.True(model.ShowEmpty);
        Assert.Empty(model.Items);
    }

    [Fact]
    public async Task SearchTextDebouncesIntoQuery()
    {
        var api = new FakeHubApiClient { Warehouse1cItRequests = Page() };
        var model = new ItRequestsViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync(CancellationToken.None);
        var calls = api.Warehouse1cItRequestsCalls.Count;

        model.SearchText = "ssd";
        await WaitFor(() => api.Warehouse1cItRequestsCalls.Count > calls);

        Assert.Equal("ssd", api.Warehouse1cItRequestsCalls[^1].Search);
    }

    [Fact]
    public async Task ViewStageWarehouseOverdueFiltersReachQuery()
    {
        var api = new FakeHubApiClient { Warehouse1cItRequests = Page() };
        var model = new ItRequestsViewModel(api);
        await model.LoadAsync(CancellationToken.None);
        // Фасеты пришли со списком — фильтр склада выбираем из них.
        var facet = model.WarehouseFacets.First(option => option.Ref == "wh-1");
        var calls = api.Warehouse1cItRequestsCalls.Count;

        model.SelectViewCommand.Execute("history");
        await WaitFor(() => api.Warehouse1cItRequestsCalls.Count > calls);
        calls = api.Warehouse1cItRequestsCalls.Count;
        model.StageFilter = "ordered";
        await WaitFor(() => api.Warehouse1cItRequestsCalls.Count > calls);
        calls = api.Warehouse1cItRequestsCalls.Count;
        model.WarehouseFilter = facet;
        await WaitFor(() => api.Warehouse1cItRequestsCalls.Count > calls);
        calls = api.Warehouse1cItRequestsCalls.Count;
        model.OverdueOnly = true;
        await WaitFor(() => api.Warehouse1cItRequestsCalls.Count > calls);

        var query = api.Warehouse1cItRequestsCalls[^1];
        Assert.Equal("history", query.View);
        Assert.Equal("ordered", query.Stage);
        Assert.Equal("wh-1", query.WarehouseRef);
        Assert.True(query.Overdue);
    }

    [Fact]
    public async Task LoadMoreAppendsNextCursorPage()
    {
        var api = new FakeHubApiClient
        {
            Warehouse1cItRequestsFactory = query =>
                string.IsNullOrEmpty(query.Cursor)
                    ? new HubItRequestsResponse
                    {
                        Items = [Request("req-1")],
                        Total = 2,
                        HasMore = true,
                        NextCursor = "it-2",
                    }
                    : new HubItRequestsResponse
                    {
                        Items = [Request("req-2", "000-ИТ-43")],
                        Total = 2,
                        HasMore = false,
                    },
        };
        var model = new ItRequestsViewModel(api);
        await model.LoadAsync(CancellationToken.None);
        Assert.Single(model.Items);
        Assert.True(model.HasMore);

        await ((NativeAsyncCommand)model.LoadMoreCommand).ExecuteAsync(null);

        Assert.Equal(2, model.Items.Count);
        Assert.Equal("it-2", api.Warehouse1cItRequestsCalls[^1].Cursor);
        Assert.Equal("000-ИТ-43", model.Items[1].Number);
        Assert.False(model.HasMore);
    }

    [Fact]
    public async Task ListErrorShowsRetryAndRecovers()
    {
        var api = new FakeHubApiClient
        {
            Warehouse1cItRequestsException = new HubApiException(
                HubApiErrorKind.Transport,
                "down"),
        };
        var model = new ItRequestsViewModel(api);

        await model.LoadAsync(CancellationToken.None);

        Assert.NotNull(model.ListErrorText);
        Assert.Contains("соединения", model.ListErrorText, StringComparison.OrdinalIgnoreCase);
        Assert.True(model.Searched);

        api.Warehouse1cItRequestsException = null;
        api.Warehouse1cItRequests = Page(Request("req-1"));
        await ((NativeAsyncCommand)model.RetryListCommand).ExecuteAsync(null);

        Assert.Null(model.ListErrorText);
        Assert.Single(model.Items);
    }

    [Fact]
    public async Task StaleAndTruncatedSnapshotShowsNotice()
    {
        var api = new FakeHubApiClient
        {
            Warehouse1cItRequests = new HubItRequestsResponse
            {
                Items = [Request("req-1")],
                Total = 1,
                Truncated = true,
                Stale = true,
            },
        };
        var model = new ItRequestsViewModel(api);

        await model.LoadAsync(CancellationToken.None);

        Assert.NotNull(model.NoticeText);
        Assert.Contains("неполный", model.NoticeText, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("устаревший", model.NoticeText, StringComparison.OrdinalIgnoreCase);
    }

    // ---- Карточка заявки ----

    [Fact]
    public async Task SelectingRequestLoadsDetailWithJourneyPositionsAndDocuments()
    {
        var api = new FakeHubApiClient
        {
            Warehouse1cItRequests = Page(Request("req-1")),
            Warehouse1cItRequestDetail = Detail("req-1"),
        };
        var model = new ItRequestsViewModel(api);
        await model.LoadAsync(CancellationToken.None);

        model.SelectedRequest = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        Assert.Equal("req-1", api.Warehouse1cItRequestDetailCalls[^1]);
        var detail = model.Detail!;
        Assert.Equal("000-ИТ-42", detail.Number);
        Assert.Contains("Заказ размещён", detail.StateDescription);
        Assert.Equal("ООО Снаб", detail.SupplierNames);
        Assert.Equal("Для серверной", detail.Comment);
        Assert.Equal(3, detail.Journey.Count);
        Assert.True(detail.Journey[0].Reached);
        Assert.True(detail.Journey[1].Current);
        Assert.False(detail.Journey[2].Reached);
        var position = Assert.Single(detail.Positions);
        Assert.Equal("SSD 1TB", position.Name);
        Assert.Contains("заказано", position.ProgressText);
        var document = Assert.Single(detail.Documents);
        Assert.Equal("Заказ поставщику", document.Label);
        Assert.Equal("PO-9", document.Number);
        Assert.Contains("SSD", document.NomenclatureText);
    }

    [Fact]
    public async Task DetailErrorShowsRetryAndRecovers()
    {
        var api = new FakeHubApiClient
        {
            Warehouse1cItRequests = Page(Request("req-1")),
            Warehouse1cItRequestDetailException = new HubApiException(
                HubApiErrorKind.Http,
                "forbidden",
                HttpStatusCode.Forbidden),
        };
        var model = new ItRequestsViewModel(api);
        await model.LoadAsync(CancellationToken.None);

        model.SelectedRequest = model.Items[0];
        await WaitFor(() => model.DetailErrorText is not null && !model.IsDetailLoading);

        Assert.Null(model.Detail);
        Assert.Contains("Недостаточно прав", model.DetailErrorText, StringComparison.OrdinalIgnoreCase);

        api.Warehouse1cItRequestDetailException = null;
        api.Warehouse1cItRequestDetail = Detail("req-1");
        await ((NativeAsyncCommand)model.RetryDetailCommand).ExecuteAsync(null);
        await WaitFor(() => model.Detail is not null);

        Assert.Null(model.DetailErrorText);
        Assert.Equal("000-ИТ-42", model.Detail!.Number);
    }

    [Fact]
    public async Task StaleDetailDoesNotOverwriteNewerSelection()
    {
        var api = new FakeHubApiClient
        {
            Warehouse1cItRequests = Page(Request("req-a", "000-А"), Request("req-b", "000-Б")),
            // Первая деталь «зависает» — выбор переключается до ответа.
            Warehouse1cItRequestDetailDelay = (reference, ct) =>
                reference == "req-a"
                    ? Task.Delay(Timeout.Infinite, ct)
                    : Task.CompletedTask,
            Warehouse1cItRequestDetailFactory = reference =>
                new HubItRequestItem
                {
                    RequestRef = reference,
                    RequestNumber = "000-" + reference,
                    Stage = new HubItRequestStage { Key = "created", Label = "Создана" },
                },
        };
        var model = new ItRequestsViewModel(api);
        await model.LoadAsync(CancellationToken.None);

        model.SelectedRequest = model.Items[0];
        await WaitFor(() => api.Warehouse1cItRequestDetailCalls.Count == 1);
        model.SelectedRequest = model.Items[1];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        Assert.Equal("req-b", api.Warehouse1cItRequestDetailCalls[^1]);
        Assert.Equal("000-req-b", model.Detail!.Number);
        Assert.Null(model.DetailErrorText);
    }

    [Fact]
    public void ResetClearsListFiltersAndDetail()
    {
        var api = new FakeHubApiClient();
        // Дебаунс поиска «висит» — сброшенная страница не догружается фоном.
        var model = new ItRequestsViewModel(api)
        {
            DelayAsync = (_, _) => Task.Delay(Timeout.Infinite),
        };
        model.Items.Add(new ItRequestItemViewModel(Request("req-1")));
        model.SelectedRequest = model.Items[0];
        model.SearchText = "ssd";
        model.SelectViewCommand.Execute("all");
        model.OverdueOnly = true;

        model.Reset();

        Assert.Empty(model.Items);
        Assert.Null(model.SelectedRequest);
        Assert.Null(model.Detail);
        Assert.Equal(string.Empty, model.SearchText);
        Assert.True(model.IsViewActive);
        Assert.False(model.OverdueOnly);
        Assert.False(model.Searched);
    }
}
