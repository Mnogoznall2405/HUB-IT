using System.Net;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NativeWarehouseViewModelTests
{
    private static HubWarehouse1cBalance BalanceRow(
        string nomenclatureRef = "nom-1",
        string warehouseRef = "wh-1",
        string? seriesRef = null,
        string nomenclature = "Кабель ВВГ 3х2.5") =>
        new()
        {
            NomenclatureRef = nomenclatureRef,
            NomenclatureCode = "CBL-01",
            NomenclatureName = nomenclature,
            CharacteristicName = "бухта 100м",
            SeriesRef = seriesRef,
            SeriesName = seriesRef is null ? null : "Серия 7",
            WarehouseRef = warehouseRef,
            WarehouseName = "ЦО",
            BatchDocumentName = "Поступление 000-11",
            BatchStatusName = "в наличии",
            QtyBalance = 12.5,
            CostBalance = 18750,
            CostAccountingBalance = 18750,
            AvgPrice = 1500,
        };

    private static HubWarehouse1cBalancesResponse BalancesPage(
        params HubWarehouse1cBalance[] items) =>
        new()
        {
            Items = items,
            Returned = items.Length,
            Total = items.Length,
            Aggregates = new HubWarehouse1cBalancesAggregates
            {
                Qty = items.Sum(row => row.QtyBalance),
                Cost = items.Sum(row => row.CostBalance),
                CostAccounting = items.Sum(row => row.CostAccountingBalance),
            },
            AsOf = "2026-11-19T10:00:00Z",
            Status = "ok",
        };

    private static HubWarehouse1cMovement MovementRow(
        string registrarRef = "reg-1",
        string number = "000-77",
        bool transfer = false) =>
        new()
        {
            RegistrarRef = registrarRef,
            RegistrarName = transfer ? "Перемещение товаров" : "Поступление товаров и услуг",
            RegistrarNumber = number,
            RegistrarDate = "2026-11-10T09:00:00Z",
            RegistrarDocumentType = transfer ? "transfer" : "receipt",
            CanOpenDetail = true,
            IsTransfer = transfer,
            Period = "2026-11-10T09:00:00Z",
            NomenclatureRef = "nom-1",
            NomenclatureName = "Кабель ВВГ",
            WarehouseRef = "wh-1",
            WarehouseName = "ЦО",
            TransferFromWarehouseName = transfer ? "ЦО" : null,
            TransferToWarehouseName = transfer ? "Склад ИТ" : null,
            QtyIn = 12,
            QtyEnd = 12,
            CostIn = 18000,
            CostEnd = 18000,
            AvgPriceEnd = 1500,
        };

    private static HubWarehouse1cMovementDetail MovementDetail(
        string registrarRef = "reg-1",
        bool transfer = true) =>
        new()
        {
            RegistrarRef = registrarRef,
            RegistrarName = "Перемещение товаров",
            RegistrarNumber = "000-5",
            RegistrarDate = "2026-11-12T10:00:00Z",
            DocumentType = "transfer",
            DocumentTitle = "Перемещение товаров",
            IsTransfer = transfer,
            WarehouseName = "ЦО",
            TransferFromWarehouseName = transfer ? "ЦО" : null,
            TransferToWarehouseName = transfer ? "Склад ИТ" : null,
            Comment = "Перемещение под заявку",
            Files =
            [
                new HubWarehouse1cMovementFile
                {
                    Ref = "file-1",
                    Name = "накладная.pdf",
                    Size = 10240,
                    ContentType = "application/pdf",
                },
            ],
        };

    private static HubWarehouse1cDismissedWarehouse DismissedItem(string warehouse = "Склад продаж") =>
        new()
        {
            Warehouse = new HubWarehouse1cCatalogItem { Ref = "wh-9", Name = warehouse },
            EmployeeName = "Сидоров Сидор",
            Position = "Менеджер",
            Department = "Продажи",
            City = "Москва",
            DismissalDate = "2026-10-01T00:00:00Z",
            EmploymentLabel = "Уволен",
            Totals = new HubWarehouse1cDismissedTotals
            {
                Qty = 7,
                Cost = 21000,
                Positions = 2,
            },
            Balances = [BalanceRow()],
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

    private static async Task SearchBalances(WarehouseViewModel model) =>
        await ((NativeAsyncCommand)model.SearchBalancesCommand).ExecuteAsync(null);

    private static async Task SearchMovements(WarehouseViewModel model) =>
        await ((NativeAsyncCommand)model.SearchMovementsCommand).ExecuteAsync(null);

    // ---- Остатки ----

    [Fact]
    public async Task BalancesSearchSendsFiltersAndFillsTableAndTotals()
    {
        var api = new FakeHubApiClient
        {
            Warehouse1cBalances = BalancesPage(
                BalanceRow(),
                BalanceRow(nomenclatureRef: "nom-2", nomenclature: "Патч-корд")),
        };
        var model = new WarehouseViewModel(api);
        model.BalNomenclature.SelectExternally("nom-1", "CBL-01 — Кабель ВВГ 3х2.5");
        model.BalWarehouse.SelectExternally("wh-1", "ЦО");
        model.BalancesText = "кабель";

        await SearchBalances(model);

        var query = Assert.Single(api.Warehouse1cBalancesCalls);
        Assert.Equal("nom-1", query.NomenclatureRef);
        Assert.Equal("wh-1", query.WarehouseRef);
        Assert.Equal("кабель", query.Text);
        Assert.Equal(2, model.Balances.Count);
        var row = model.Balances[0];
        Assert.Equal("CBL-01 — Кабель ВВГ 3х2.5", row.NomenclatureTitle);
        Assert.Equal("ЦО", row.WarehouseName);
        Assert.Contains("12", row.QtyText);
        Assert.Contains("найдено позиций: 2", model.BalancesResultText.ToLowerInvariant());
        Assert.Contains("Σ", model.BalancesTotalsText);
        Assert.True(model.BalancesSearched);
        Assert.True(model.HasBalances);
        Assert.Null(model.BalancesErrorText);
    }

    [Fact]
    public void BalancesSearchRequiresAtLeastOneFilter()
    {
        var api = new FakeHubApiClient();
        var model = new WarehouseViewModel(api);

        Assert.False(model.CanSearchBalances);
        Assert.False(model.SearchBalancesCommand.CanExecute(null));

        model.BalancesText = "кабель";

        Assert.True(model.CanSearchBalances);
        Assert.True(model.SearchBalancesCommand.CanExecute(null));
    }

    [Fact]
    public async Task BalancesErrorShowsRetryAndRecovers()
    {
        var api = new FakeHubApiClient
        {
            Warehouse1cBalancesException = new HubApiException(
                HubApiErrorKind.Transport,
                "down"),
        };
        var model = new WarehouseViewModel(api);
        model.BalancesText = "кабель";

        await SearchBalances(model);

        Assert.NotNull(model.BalancesErrorText);
        Assert.Contains("соединения", model.BalancesErrorText, StringComparison.OrdinalIgnoreCase);
        Assert.True(model.BalancesSearched);

        api.Warehouse1cBalancesException = null;
        api.Warehouse1cBalances = BalancesPage(BalanceRow());
        await ((NativeAsyncCommand)model.RetryBalancesCommand).ExecuteAsync(null);

        Assert.Null(model.BalancesErrorText);
        Assert.Single(model.Balances);
    }

    [Fact]
    public async Task BalancesIncompleteEnvelopeShowsNotice()
    {
        var api = new FakeHubApiClient
        {
            Warehouse1cBalances = new HubWarehouse1cBalancesResponse
            {
                Items = [BalanceRow()],
                Returned = 1,
                Total = 500,
                HasMore = true,
                Status = "ok",
            },
        };
        var model = new WarehouseViewModel(api);
        model.BalancesText = "кабель";

        await SearchBalances(model);

        Assert.NotNull(model.BalancesNoticeText);
        Assert.Contains("неполная", model.BalancesNoticeText, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("500", model.BalancesNoticeText);
    }

    [Fact]
    public async Task EmptyBalancesShowEmptyStateAfterSearch()
    {
        var api = new FakeHubApiClient
        {
            Warehouse1cBalances = BalancesPage(),
        };
        var model = new WarehouseViewModel(api);
        model.BalancesText = "ssd";

        await SearchBalances(model);

        Assert.True(model.ShowBalancesEmpty);
        Assert.Empty(model.Balances);
    }

    // ---- Подсказки справочников ----

    [Fact]
    public async Task SuggestFieldDebouncesTextIntoSearchAndSelectionHoldsRef()
    {
        var api = new FakeHubApiClient
        {
            Warehouse1cNomenclatureSearch =
            [
                new HubWarehouse1cCatalogItem
                {
                    Ref = "nom-1",
                    Code = "CBL-01",
                    Name = "Кабель ВВГ",
                },
            ],
        };
        var model = new WarehouseViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };

        model.BalNomenclature.Text = "каб";
        await WaitFor(() => api.Warehouse1cNomenclatureSearchQueries.Count > 0);

        Assert.Equal("каб", api.Warehouse1cNomenclatureSearchQueries[^1]);
        var option = Assert.Single(model.BalNomenclature.Options);
        Assert.Equal("CBL-01 — Кабель ВВГ", option.Text);

        model.BalNomenclature.SelectedOption = option;

        Assert.Equal("nom-1", model.BalNomenclature.SelectedRef);
        Assert.Equal("CBL-01 — Кабель ВВГ", model.BalNomenclature.Text);
    }

    [Fact]
    public void SuggestFieldClearsRefWhenTextNoLongerMatchesSelection()
    {
        var api = new FakeHubApiClient();
        var model = new WarehouseViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        model.BalNomenclature.SelectExternally("nom-1", "CBL-01 — Кабель ВВГ");
        Assert.Equal("nom-1", model.BalNomenclature.SelectedRef);

        model.BalNomenclature.Text = "другое";

        Assert.Null(model.BalNomenclature.SelectedRef);
    }

    // ---- Ведомость ----

    [Fact]
    public async Task MovementsSearchSendsNomenclatureWarehouseSeriesDatesAndCursor()
    {
        var api = new FakeHubApiClient
        {
            Warehouse1cMovements = new HubWarehouse1cMovementsResponse
            {
                Items = [MovementRow()],
                Returned = 1,
                HasMore = true,
                NextCursor = "mv-2",
                Status = "ok",
            },
        };
        var model = new WarehouseViewModel(api);
        Assert.False(model.CanSearchMovements);

        model.MovNomenclature.SelectExternally("nom-1", "CBL-01 — Кабель ВВГ");
        model.MovWarehouse.SelectExternally("wh-1", "ЦО");
        model.MovementsDateFrom = new DateTime(2026, 11, 1);
        model.MovementsDateTo = new DateTime(2026, 11, 19);

        await SearchMovements(model);

        var query = Assert.Single(api.Warehouse1cMovementsCalls);
        Assert.Equal("nom-1", query.NomenclatureRef);
        Assert.Equal("wh-1", query.WarehouseRef);
        Assert.Equal("2026-11-01", query.DateFrom);
        Assert.Equal("2026-11-19", query.DateTo);
        Assert.Null(query.Cursor);
        Assert.Single(model.Movements);
        Assert.True(model.HasMoreMovements);
        Assert.False(model.IsMovementsTab); // вкладка не переключается сама
    }

    [Fact]
    public async Task LoadMoreMovementsAppendsNextCursorPage()
    {
        var api = new FakeHubApiClient
        {
            Warehouse1cMovementsFactory = query =>
                string.IsNullOrEmpty(query.Cursor)
                    ? new HubWarehouse1cMovementsResponse
                    {
                        Items = [MovementRow("reg-1")],
                        Returned = 1,
                        HasMore = true,
                        NextCursor = "mv-2",
                    }
                    : new HubWarehouse1cMovementsResponse
                    {
                        Items = [MovementRow("reg-2", "000-78")],
                        Returned = 1,
                        HasMore = false,
                    },
        };
        var model = new WarehouseViewModel(api);
        model.MovNomenclature.SelectExternally("nom-1", "Кабель");
        await SearchMovements(model);
        Assert.Single(model.Movements);

        await ((NativeAsyncCommand)model.LoadMoreMovementsCommand).ExecuteAsync(null);

        Assert.Equal(2, model.Movements.Count);
        Assert.Equal("mv-2", api.Warehouse1cMovementsCalls[^1].Cursor);
        Assert.False(model.HasMoreMovements);
    }

    [Fact]
    public async Task SelectingMovementLoadsDocumentCard()
    {
        var api = new FakeHubApiClient
        {
            Warehouse1cMovements = new HubWarehouse1cMovementsResponse
            {
                Items = [MovementRow("reg-1", transfer: true)],
                Returned = 1,
            },
            Warehouse1cMovementDetail = MovementDetail("reg-1"),
        };
        var model = new WarehouseViewModel(api);
        model.MovNomenclature.SelectExternally("nom-1", "Кабель");
        await SearchMovements(model);

        model.SelectedMovement = model.Movements[0];
        await WaitFor(() => model.MovementDetail is not null && !model.IsMovementDetailLoading);

        Assert.Equal("reg-1", api.Warehouse1cMovementDetailCalls[^1]);
        var detail = model.MovementDetail!;
        Assert.Contains("Перемещение товаров", detail.Title);
        Assert.Equal("ЦО → Склад ИТ", detail.RouteText);
        Assert.Equal("Перемещение под заявку", detail.CommentText);
        var file = Assert.Single(detail.Files);
        Assert.Equal("file-1", file.Ref);
        Assert.Contains("КБ", file.SizeText);
    }

    [Fact]
    public async Task MovementDetailErrorShowsRetryAndRecovers()
    {
        var api = new FakeHubApiClient
        {
            Warehouse1cMovements = new HubWarehouse1cMovementsResponse
            {
                Items = [MovementRow("reg-1")],
                Returned = 1,
            },
            Warehouse1cMovementDetailException = new HubApiException(
                HubApiErrorKind.Http,
                "forbidden",
                HttpStatusCode.Forbidden),
        };
        var model = new WarehouseViewModel(api);
        model.MovNomenclature.SelectExternally("nom-1", "Кабель");
        await SearchMovements(model);

        model.SelectedMovement = model.Movements[0];
        await WaitFor(() => model.MovementDetailErrorText is not null && !model.IsMovementDetailLoading);

        Assert.Null(model.MovementDetail);
        Assert.Contains("Недостаточно прав", model.MovementDetailErrorText, StringComparison.OrdinalIgnoreCase);

        api.Warehouse1cMovementDetailException = null;
        api.Warehouse1cMovementDetail = MovementDetail("reg-1");
        await ((NativeAsyncCommand)model.RetryMovementDetailCommand).ExecuteAsync(null);
        await WaitFor(() => model.MovementDetail is not null);

        Assert.Null(model.MovementDetailErrorText);
        Assert.NotNull(model.MovementDetail);
    }

    [Fact]
    public async Task StaleMovementDetailDoesNotOverwriteNewerSelection()
    {
        var api = new FakeHubApiClient
        {
            Warehouse1cMovements = new HubWarehouse1cMovementsResponse
            {
                Items = [MovementRow("reg-a", "000-1"), MovementRow("reg-b", "000-2")],
                Returned = 2,
            },
            // Первая деталь «зависает» — выбор переключается до ответа.
            Warehouse1cMovementDetailDelay = (reference, ct) =>
                reference == "reg-a"
                    ? Task.Delay(Timeout.Infinite, ct)
                    : Task.CompletedTask,
            Warehouse1cMovementDetail = MovementDetail("reg-b"),
        };
        var model = new WarehouseViewModel(api);
        model.MovNomenclature.SelectExternally("nom-1", "Кабель");
        await SearchMovements(model);

        model.SelectedMovement = model.Movements[0];
        await WaitFor(() => api.Warehouse1cMovementDetailCalls.Count == 1);
        model.SelectedMovement = model.Movements[1];
        await WaitFor(() => model.MovementDetail is not null && !model.IsMovementDetailLoading);

        Assert.Equal("reg-b", api.Warehouse1cMovementDetailCalls[^1]);
        Assert.NotNull(model.MovementDetail);
        Assert.Null(model.MovementDetailErrorText);
    }

    [Fact]
    public async Task ShowMovementsFromBalancePrefillsFiltersAndSwitchesTab()
    {
        var api = new FakeHubApiClient
        {
            Warehouse1cBalances = BalancesPage(BalanceRow(seriesRef: "ser-1")),
            Warehouse1cMovements = new HubWarehouse1cMovementsResponse
            {
                Items = [MovementRow()],
                Returned = 1,
            },
        };
        var model = new WarehouseViewModel(api);
        model.BalancesText = "кабель";
        await SearchBalances(model);

        model.ShowMovementsCommand.Execute(model.Balances[0]);
        await WaitFor(() => api.Warehouse1cMovementsCalls.Count == 1);

        Assert.True(model.IsMovementsTab);
        Assert.Equal("nom-1", model.MovNomenclature.SelectedRef);
        Assert.Equal("wh-1", model.MovWarehouse.SelectedRef);
        Assert.True(model.HasSeriesFilter);
        Assert.Contains("Серия 7", model.SeriesFilterText);
        var query = api.Warehouse1cMovementsCalls[^1];
        Assert.Equal("nom-1", query.NomenclatureRef);
        Assert.Equal("wh-1", query.WarehouseRef);
        Assert.Equal("ser-1", query.SeriesRef);

        model.ClearSeriesCommand.Execute(null);
        Assert.False(model.HasSeriesFilter);
    }

    // ---- Уволенные ----

    [Fact]
    public async Task DismissedTabAutoLoadsOnFirstActivationAndShowsOwner()
    {
        var api = new FakeHubApiClient
        {
            Warehouse1cDismissed = new HubWarehouse1cDismissedResponse
            {
                Items = [DismissedItem()],
                Returned = 1,
            },
        };
        var model = new WarehouseViewModel(api);
        Assert.Equal(0, api.Warehouse1cDismissedCallCount);

        model.SelectTabCommand.Execute("dismissed");
        await WaitFor(() => api.Warehouse1cDismissedCallCount == 1 && !model.IsDismissedLoading);

        var item = Assert.Single(model.DismissedItems);
        Assert.Equal("Склад продаж", item.WarehouseName);
        Assert.Equal("Сидоров Сидор", item.EmployeeName);
        Assert.Contains("Менеджер", item.EmployeeMeta);
        Assert.Contains("уволен", item.EmployeeMeta);
        Assert.Contains("Позиций: 2", item.TotalsText);
        Assert.Single(item.Balances);

        model.SelectedDismissed = item;
        Assert.Same(item, model.SelectedDismissed);
    }

    [Fact]
    public async Task DismissedErrorShowsRetry()
    {
        var api = new FakeHubApiClient
        {
            Warehouse1cDismissedException = new HubApiException(
                HubApiErrorKind.Transport,
                "down"),
        };
        var model = new WarehouseViewModel(api);

        await ((NativeAsyncCommand)model.LoadDismissedCommand).ExecuteAsync(null);

        Assert.NotNull(model.DismissedErrorText);
        Assert.True(model.DismissedSearched);

        api.Warehouse1cDismissedException = null;
        api.Warehouse1cDismissed = new HubWarehouse1cDismissedResponse
        {
            Items = [DismissedItem()],
            Returned = 1,
        };
        await ((NativeAsyncCommand)model.RetryDismissedCommand).ExecuteAsync(null);

        Assert.Null(model.DismissedErrorText);
        Assert.Single(model.DismissedItems);
    }

    // ---- Общие состояния ----

    [Fact]
    public async Task LoadAsyncReadsCatalogStatus()
    {
        var api = new FakeHubApiClient
        {
            Warehouse1cCatalogStatus = new HubWarehouse1cCatalogStatus
            {
                NomenclatureCount = 5000,
                WarehousesCount = 14,
                UpdatedAt = "2026-11-19T10:00:00Z",
            },
        };
        var model = new WarehouseViewModel(api);

        await model.LoadAsync(CancellationToken.None);

        // "N0" в ru-RU разделяет тысячи неразрывным пробелом — нормализуем.
        var statusText = model.CatalogStatusText.Replace(' ', ' ').Replace(' ', ' ');
        Assert.Contains("5 000", statusText);
        Assert.Contains("14", statusText);
        Assert.Null(model.BannerErrorText);
        // Списки по статусу не грузятся — они запускаются фильтрами.
        Assert.Empty(api.Warehouse1cBalancesCalls);
        Assert.Empty(api.Warehouse1cMovementsCalls);
        Assert.Equal(0, api.Warehouse1cDismissedCallCount);
    }

    [Fact]
    public async Task CatalogStatusFailureKeepsPageUsable()
    {
        var api = new FakeHubApiClient
        {
            Warehouse1cCatalogStatusException = new HubApiException(
                HubApiErrorKind.Transport,
                "down"),
        };
        var model = new WarehouseViewModel(api);

        await model.LoadAsync(CancellationToken.None);

        Assert.NotNull(model.BannerErrorText);
        Assert.Contains("недоступен", model.CatalogStatusText, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ResetClearsAllTabsAndFilters()
    {
        var api = new FakeHubApiClient();
        var model = new WarehouseViewModel(api);
        model.BalNomenclature.SelectExternally("nom-1", "Кабель");
        model.BalancesText = "кабель";
        model.MovementsDateFrom = new DateTime(2026, 11, 1);
        model.Balances.Add(new WarehouseBalanceRowViewModel(
            BalanceRow(),
            model.ShowMovementsCommand));
        model.SelectTabCommand.Execute("dismissed");

        model.Reset();

        Assert.Empty(model.Balances);
        Assert.Null(model.BalNomenclature.SelectedRef);
        Assert.Equal(string.Empty, model.BalancesText);
        Assert.Null(model.MovementsDateFrom);
        Assert.True(model.IsBalancesTab);
        Assert.False(model.BalancesSearched);
        Assert.False(model.MovementsSearched);
        Assert.False(model.DismissedSearched);
    }
}
