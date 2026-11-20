using System.Net;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NativeStatisticsViewModelTests
{
    private static string Now() => DateTimeOffset.UtcNow.ToString("o");

    private static HubUser UserWithPermissions(params string[] permissions) => new()
    {
        Id = 7,
        Username = "ivanov",
        Permissions = permissions,
    };

    private static HubPcCleaningStatistics PcStats() => new()
    {
        GeneratedAt = Now(),
        PeriodDays = 90,
        StartDate = "2025-08-01",
        EndDate = "2025-10-30",
        Totals = new HubPcCleaningStatisticsTotals
        {
            TotalPc = 10,
            CleanedPc = 7,
            RemainingPc = 3,
            CoveragePercent = 70,
            CleaningsTotal = 25,
            CleaningsPeriod = 9,
        },
        Branches =
        [
            new HubPcCleaningBranchStat
            {
                Branch = "ЦО",
                TotalPc = 6,
                CleanedPc = 5,
                RemainingPc = 1,
                CoveragePercent = 83.3,
                CleaningsTotal = 15,
                CleaningsPeriod = 6,
            },
            new HubPcCleaningBranchStat
            {
                Branch = "СПб",
                TotalPc = 4,
                CleanedPc = 2,
                RemainingPc = 2,
                CoveragePercent = 50,
                CleaningsTotal = 10,
                CleaningsPeriod = 3,
            },
        ],
    };

    private static HubMfuWorksStatistics MfuStats() => new()
    {
        GeneratedAt = Now(),
        PeriodDays = 90,
        StartDate = "2025-08-01",
        EndDate = "2025-10-30",
        Totals = new HubMfuWorksTotals { TotalOperations = 12, UniqueBranches = 2, UniqueLocations = 3 },
        ByTypePeriod = new Dictionary<string, int> { ["Картридж"] = 8, ["Фьюзер"] = 4 },
        ByItemPeriod = new Dictionary<string, int> { ["CE285A"] = 5 },
        ByBranchPeriod = new Dictionary<string, int> { ["ЦО"] = 9, ["СПб"] = 3 },
        ByModelPeriod = [new HubMfuWorksModelStat { Model = "HP LaserJet M404", Count = 7 }],
        ByLocationPeriod =
        [
            new HubMfuWorksLocationStat
            {
                Branch = "ЦО",
                Location = "Кабинет 101",
                Operations = 5,
                LastTimestamp = Now(),
                TopItems = [new HubMfuWorksLocationItemStat { Name = "CE285A", Count = 3 }],
            },
        ],
        RecentReplacements =
        [
            new HubMfuMaintenanceEvent
            {
                Timestamp = Now(),
                Branch = "ЦО",
                Location = "Кабинет 101",
                PrinterModel = "HP LaserJet M404",
                ComponentType = "Картридж",
                ReplacementItem = "CE285A",
            },
        ],
    };

    private static HubBatteryStatistics BatteryStats() => new()
    {
        GeneratedAt = Now(),
        PeriodDays = 30,
        StartDate = "2025-10-01",
        EndDate = "2025-10-30",
        Totals = new HubBatteryStatisticsTotals { TotalOperations = 4, UniqueBranches = 1, UniqueLocations = 2 },
        ByItemPeriod = new Dictionary<string, int> { ["APC RBC17"] = 3 },
        ByManufacturerPeriod = new Dictionary<string, int> { ["APC"] = 4 },
        ByBranchPeriod = new Dictionary<string, int> { ["ЦО"] = 4 },
        ByLocationPeriod =
        [
            new HubBatteryLocationStat
            {
                Branch = "ЦО",
                Location = "Серверная",
                Operations = 3,
                LastTimestamp = Now(),
                TopItems = [new HubBatteryLocationItemStat { Name = "APC RBC17", Count = 2 }],
            },
        ],
        RecentReplacements =
        [
            new HubBatteryReplacementEvent
            {
                Timestamp = Now(),
                Branch = "ЦО",
                Location = "Серверная",
                ModelName = "Smart-UPS 750",
                Manufacturer = "APC",
                ReplacementItem = "APC RBC17",
            },
        ],
    };

    private static HubPcComponentsStatistics ComponentsStats() => new()
    {
        GeneratedAt = Now(),
        PeriodDays = 30,
        StartDate = "2025-10-01",
        EndDate = "2025-10-30",
        Totals = new HubPcComponentsStatisticsTotals { TotalOperations = 6, UniqueBranches = 2, UniqueLocations = 2 },
        ByComponentPeriod = new Dictionary<string, int> { ["SSD"] = 4, ["RAM"] = 2 },
        ByItemPeriod = new Dictionary<string, int> { ["Samsung 870 EVO"] = 3 },
        ByBranchPeriod = new Dictionary<string, int> { ["ЦО"] = 5, ["СПб"] = 1 },
        ByModelPeriod = [new HubPcComponentsModelStat { Model = "HP ProDesk 400", Count = 4 }],
        ByLocationPeriod =
        [
            new HubPcComponentsLocationStat
            {
                Branch = "ЦО",
                Location = "Офис",
                Operations = 5,
                LastTimestamp = Now(),
                TopItems = [new HubPcComponentsLocationItemStat { Name = "Samsung 870 EVO", Count = 3 }],
            },
        ],
        RecentReplacements =
        [
            new HubPcComponentsReplacementEvent
            {
                Timestamp = Now(),
                Branch = "ЦО",
                Location = "Офис",
                ModelName = "HP ProDesk 400",
                ComponentName = "SSD",
                ReplacementItem = "Samsung 870 EVO",
            },
        ],
    };

    // ---- Чистка ПК ----

    [Fact]
    public async Task LoadFillsPcCleaningMetricsAndBranchRows()
    {
        var api = new FakeHubApiClient { PcCleaningStatistics = PcStats() };
        var model = new StatisticsViewModel(api);

        await model.LoadAsync();

        Assert.True(model.IsPcTab);
        Assert.True(model.ShowPcTable);
        Assert.False(model.ShowOperationsTables);
        Assert.Equal("Статистика чистки ПК", model.TitleText);
        Assert.Equal("Период: 2025-08-01 - 2025-10-30", model.PeriodRangeText);
        Assert.False(model.HasBannerError);

        // Карточки веба: ПК всего / Почищено / Осталось / Покрытие / Чисток за период.
        Assert.Equal(
            ["ПК всего", "Почищено", "Осталось", "Покрытие", "Чисток за период"],
            model.MetricCards.Select(card => card.Title).ToArray());
        Assert.Equal("10", model.MetricCards[0].ValueText);
        Assert.Equal("success", model.MetricCards[1].Tone);
        Assert.Equal("error", model.MetricCards[2].Tone);
        Assert.Equal("70%", model.MetricCards[3].ValueText);
        Assert.Equal("9", model.MetricCards[4].ValueText);

        Assert.Equal(2, model.PcBranches.Count);
        var first = model.PcBranches[0];
        Assert.Equal("ЦО", first.Branch);
        Assert.Equal("6", first.TotalPcText);
        Assert.Equal("5", first.CleanedPcText);
        Assert.Equal("1", first.RemainingPcText);
        Assert.Equal("error", first.RemainingTone);
        Assert.Equal("83,3%", first.CoverageText);
        Assert.Equal("success", first.CoverageTone);
        Assert.Equal("50%", model.PcBranches[1].CoverageText);
        Assert.Equal("warning", model.PcBranches[1].CoverageTone);
        Assert.Equal([90], api.PcCleaningStatisticsCalls);
    }

    [Fact]
    public async Task SearchTextFiltersPcBranchesLocally()
    {
        var api = new FakeHubApiClient { PcCleaningStatistics = PcStats() };
        var model = new StatisticsViewModel(api);
        await model.LoadAsync();

        model.SearchText = "спб";

        var row = Assert.Single(model.PcBranches);
        Assert.Equal("СПб", row.Branch);
        // Повторный запрос не нужен — фильтр клиентский, как в вебе.
        Assert.Equal([90], api.PcCleaningStatisticsCalls);
    }

    // ---- Период и разделы ----

    [Fact]
    public async Task SelectingPeriodReloadsWithNewPeriodDays()
    {
        var api = new FakeHubApiClient { PcCleaningStatistics = PcStats() };
        var model = new StatisticsViewModel(api);
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.SelectPeriodCommand)
            .ExecuteAsync(model.PeriodOptions.First(option => option.Value == "365"));

        Assert.Equal("365 дней", model.SelectedPeriodText);
        Assert.Equal(365, model.PeriodDays);
        Assert.Equal([90, 365], api.PcCleaningStatisticsCalls);
    }

    [Fact]
    public async Task SelectingBatteryTabLoadsBatteryStatistics()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = UserWithPermissions("mfu.read"),
            BatteryStatistics = BatteryStats(),
        };
        var model = new StatisticsViewModel(api);
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.SelectTabCommand).ExecuteAsync("battery");

        Assert.True(model.IsBatteryTab);
        Assert.False(model.ShowPcTable);
        Assert.True(model.ShowOperationsTables);
        Assert.Equal("Статистика замены батарей ИБП", model.TitleText);
        Assert.Equal("Где меняли батареи", model.LocationsTitleText);
        Assert.Equal("Замен", model.LocationOpsHeaderText);
        Assert.Equal("Последние замены батарей", model.RecentTitleText);
        Assert.Equal("Модель ИБП", model.RecentModelHeaderText);
        Assert.Equal("Производитель", model.RecentKindHeaderText);
        Assert.Equal([90], api.BatteryStatisticsCalls);

        Assert.Equal(
            ["Замен за период", "Филиалов", "Локаций"],
            model.MetricCards.Select(card => card.Title).ToArray());
        // Срезы веба у батарей: позиции, производители, филиалы — без моделей.
        Assert.Equal(
            ["Сколько батарей использовано", "По производителям ИБП", "По филиалам"],
            model.Slices.Select(slice => slice.Title).ToArray());
        var location = Assert.Single(model.Locations);
        Assert.Equal("Серверная", location.Location);
        Assert.Equal("3", location.OperationsText);
        Assert.Contains("APC RBC17 (2)", location.TopItemsText);
        var recent = Assert.Single(model.RecentItems);
        Assert.Equal("Smart-UPS 750", recent.ModelText);
        Assert.Equal("APC", recent.KindText);
        Assert.Equal("APC RBC17", recent.ItemText);
    }

    [Fact]
    public async Task SelectingMfuTabRequiresMfuReadPermission()
    {
        var api = new FakeHubApiClient
        {
            // Без mfu.read вкладки МФУ нет — как canViewMfu веба.
            CurrentUser = UserWithPermissions("database.read"),
            MfuWorksStatistics = MfuStats(),
        };
        var model = new StatisticsViewModel(api);
        await model.LoadAsync();

        Assert.False(model.ShowMfuTab);

        await ((NativeAsyncCommand)model.SelectTabCommand).ExecuteAsync("mfu");

        // Попытка открыть скрытый раздел откатывается на «Чистку ПК» — как в вебе.
        Assert.True(model.IsPcTab);
        Assert.Equal(0, api.MfuWorksStatisticsCallCount);
    }

    [Fact]
    public async Task SelectingMfuTabLoadsStatisticsWhenPermitted()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = UserWithPermissions("mfu.read"),
            MfuWorksStatistics = MfuStats(),
        };
        var model = new StatisticsViewModel(api);
        await model.LoadAsync();

        Assert.True(model.ShowMfuTab);

        await ((NativeAsyncCommand)model.SelectTabCommand).ExecuteAsync("mfu");

        Assert.True(model.IsMfuTab);
        Assert.Equal("Статистика обслуживания МФУ", model.TitleText);
        Assert.Equal("Где меняли", model.LocationsTitleText);
        Assert.Equal("Операций", model.LocationOpsHeaderText);
        Assert.Equal(1, api.MfuWorksStatisticsCallCount);
        Assert.Equal(
            ["Сколько чего использовано (типы)", "Сколько чего использовано (позиции)", "По филиалам", "По моделям МФУ"],
            model.Slices.Select(slice => slice.Title).ToArray());
        Assert.Equal("12", model.MetricCards[0].ValueText);
        var recent = Assert.Single(model.RecentItems);
        Assert.Equal("HP LaserJet M404", recent.ModelText);
        Assert.Equal("Картридж", recent.KindText);
    }

    [Fact]
    public async Task SelectingComponentsTabLoadsPcComponentsStatistics()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = UserWithPermissions("mfu.read"),
            PcComponentsStatistics = ComponentsStats(),
        };
        var model = new StatisticsViewModel(api);
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.SelectTabCommand).ExecuteAsync("pc_components");

        Assert.True(model.IsPcComponentsTab);
        Assert.Equal("Статистика комплектующих ПК", model.TitleText);
        Assert.Equal("Модель ПК", model.RecentModelHeaderText);
        Assert.Equal("Компонент", model.RecentKindHeaderText);
        Assert.Equal([90], api.PcComponentsStatisticsCalls);
        Assert.Equal(
            ["По компонентам", "По позициям", "По филиалам", "По моделям ПК"],
            model.Slices.Select(slice => slice.Title).ToArray());
        var recent = Assert.Single(model.RecentItems);
        Assert.Equal("SSD", recent.KindText);
        Assert.Equal("Samsung 870 EVO", recent.ItemText);
    }

    [Fact]
    public async Task SearchTextFiltersLocationsByBranchAndLocation()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = UserWithPermissions("mfu.read"),
            MfuWorksStatistics = MfuStats(),
        };
        var model = new StatisticsViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.SelectTabCommand).ExecuteAsync("mfu");

        model.SearchText = "кабинет";

        Assert.Single(model.Locations);
        model.SearchText = "нет такого";
        Assert.Empty(model.Locations);
        // Последние записи фильтр не режет — как в вебе.
        Assert.Single(model.RecentItems);
    }

    // ---- Ошибки и сброс ----

    [Fact]
    public async Task LoadFailureSetsBannerError()
    {
        var api = new FakeHubApiClient
        {
            PcCleaningStatisticsException = new HubApiException(HubApiErrorKind.Transport, "network down"),
        };
        var model = new StatisticsViewModel(api);

        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);

        Assert.True(model.HasBannerError);
        Assert.False(model.IsLoading);
        Assert.Contains("соединения", model.BannerErrorText, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task TabLoadFailureSetsBannerError()
    {
        var api = new FakeHubApiClient
        {
            PcCleaningStatistics = PcStats(),
            BatteryStatisticsException = new HubApiException(
                HubApiErrorKind.Http, "forbidden", HttpStatusCode.Forbidden),
        };
        var model = new StatisticsViewModel(api);
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.SelectTabCommand).ExecuteAsync("battery");

        Assert.True(model.IsBatteryTab);
        Assert.True(model.HasBannerError);
        Assert.Contains("прав", model.BannerErrorText, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void SetLoadErrorExposesShellMessage()
    {
        var model = new StatisticsViewModel(new FakeHubApiClient());

        model.SetLoadError("Нет соединения с сервером HUB. Проверьте сеть и повторите попытку.");

        Assert.True(model.HasBannerError);
        Assert.False(model.IsLoading);
    }

    [Fact]
    public async Task ResetClearsDataAndRestoresDefaults()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = UserWithPermissions("mfu.read"),
            PcCleaningStatistics = PcStats(),
            MfuWorksStatistics = MfuStats(),
        };
        var model = new StatisticsViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.SelectPeriodCommand)
            .ExecuteAsync(model.PeriodOptions.First(option => option.Value == "30"));
        await ((NativeAsyncCommand)model.SelectTabCommand).ExecuteAsync("mfu");
        model.SearchText = "ЦО";
        Assert.NotEmpty(model.Locations);

        model.Reset();

        Assert.True(model.IsPcTab);
        Assert.Equal("Статистика чистки ПК", model.TitleText);
        Assert.Equal("90 дней", model.SelectedPeriodText);
        Assert.Equal(string.Empty, model.SearchText);
        Assert.Equal(string.Empty, model.PeriodRangeText);
        Assert.Empty(model.MetricCards);
        Assert.Empty(model.Slices);
        Assert.Empty(model.PcBranches);
        Assert.Empty(model.Locations);
        Assert.Empty(model.RecentItems);
        Assert.False(model.HasBannerError);
        Assert.False(model.IsLoading);
        Assert.False(model.ShowMfuTab);
    }

    // ---- «ПК без чистки» (PcRemainingDialog) ----

    private static HubPcCleaningRemaining RemainingList() => new()
    {
        Branch = "ЦО",
        PeriodDays = 90,
        TotalPc = 6,
        RemainingPc = 2,
        RemainingPcs =
        [
            new HubPcCleaningRemainingPc
            {
                InvNo = "100234",
                SerialNo = "SN-1",
                Location = "Кабинет 101",
                ModelName = "HP ProDesk 400",
                Employee = "Петров Пётр",
                LastCleanedAt = "2025-06-01T09:00:00Z",
                EquipmentId = 5,
                Manufacturer = "HP",
            },
            new HubPcCleaningRemainingPc
            {
                InvNo = "100235",
                SerialNo = "SN-2",
                HwSerialNo = "HW-2",
                Location = "Кабинет 102",
                ModelName = "Dell OptiPlex",
                Employee = "Иванова Анна",
                LastCleanedAt = null,
            },
        ],
    };

    private static async Task WaitFor(Func<bool> condition)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(5);
        while (DateTime.UtcNow < deadline)
        {
            if (condition())
            {
                return;
            }

            await Task.Delay(20);
        }

        Assert.True(condition(), "Условие не наступило за отведённое время.");
    }

    private static async Task<PcRemainingViewModel> OpenRemainingAsync(
        FakeHubApiClient api, StatisticsViewModel model, int rowIndex = 0)
    {
        model.OpenPcRemainingCommand.Execute(model.PcBranches[rowIndex]);
        Assert.True(model.IsPcRemainingOpen);
        var dialog = model.PcRemaining!;
        await WaitFor(() => dialog.Items.Count > 0 || dialog.HasError);
        return dialog;
    }

    [Fact]
    public async Task BranchRowOpensRemainingDialogWithBranchAndPeriod()
    {
        var api = new FakeHubApiClient
        {
            PcCleaningStatistics = PcStats(),
            PcCleaningRemaining = RemainingList(),
        };
        var model = new StatisticsViewModel(api);
        await model.LoadAsync();

        var dialog = await OpenRemainingAsync(api, model);

        Assert.Equal("Не почищены: ЦО", dialog.TitleText);
        Assert.Equal((90, "ЦО"), Assert.Single(api.PcCleaningRemainingCalls));
        Assert.Equal("2 из 6 ПК без чистки за выбранный период", dialog.SummaryText);
        Assert.Equal(2, dialog.Items.Count);
        var row = dialog.Items[0];
        Assert.Equal("100234", row.InvNoText);
        Assert.Equal("SN-1", row.SerialText);
        Assert.Equal("HP ProDesk 400", row.ModelText);
        Assert.Equal("Кабинет 101", row.LocationText);
        Assert.Equal("Петров Пётр", row.EmployeeText);
        Assert.Equal("warning", row.LastCleanedTone);
        Assert.Equal("Не чистили", dialog.Items[1].LastCleanedText);
        Assert.Equal("error", dialog.Items[1].LastCleanedTone);
    }

    [Fact]
    public async Task RemainingDialogQueryFiltersRowsLocally()
    {
        var api = new FakeHubApiClient
        {
            PcCleaningStatistics = PcStats(),
            PcCleaningRemaining = RemainingList(),
        };
        var model = new StatisticsViewModel(api);
        await model.LoadAsync();
        var dialog = await OpenRemainingAsync(api, model);

        dialog.QueryText = "иванова";

        var row = Assert.Single(dialog.Items);
        Assert.Equal("100235", row.InvNoText);
        dialog.QueryText = "нет такого";
        Assert.Empty(dialog.Items);
        Assert.True(dialog.ShowEmpty);
        Assert.Equal("Нет ПК по выбранному фильтру", dialog.EmptyText);
        // Повторный запрос не нужен — filterRemainingPcs клиентский.
        Assert.Single(api.PcCleaningRemainingCalls);
    }

    [Fact]
    public async Task ConfirmCleanRegistersWorkRemovesRowAndReloadsStats()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = UserWithPermissions("database.read", "database.write"),
            PcCleaningStatistics = PcStats(),
            PcCleaningRemaining = RemainingList(),
        };
        var model = new StatisticsViewModel(api);
        await model.LoadAsync();
        var dialog = await OpenRemainingAsync(api, model);
        Assert.True(dialog.CanWrite);

        dialog.RequestCleanCommand.Execute(dialog.Items[0]);
        Assert.True(dialog.IsConfirmOpen);
        Assert.Contains("100234", dialog.ConfirmText);

        await ((NativeAsyncCommand)dialog.ConfirmCleanCommand).ExecuteAsync(null);

        var request = Assert.Single(api.RegisterCleaningWorkRequests);
        Assert.Equal("SN-1", request.SerialNumber);
        Assert.Equal("Петров Пётр", request.Employee);
        Assert.Equal("ЦО", request.Branch);
        Assert.Equal("Кабинет 101", request.Location);
        Assert.Equal("100234", request.InvNo);
        Assert.Equal<long?>(5, request.EquipmentId);
        Assert.Equal("HP", request.Manufacturer);
        Assert.False(dialog.IsConfirmOpen);
        var row = Assert.Single(dialog.Items);
        Assert.Equal("100235", row.InvNoText);
        Assert.Equal("1 из 6 ПК без чистки за выбранный период", dialog.SummaryText);
        // Чистка сдвинула покрытие — раздел перечитан (CleaningSaved → LoadAsync).
        await WaitFor(() => api.PcCleaningStatisticsCalls.Count == 2);
    }

    [Fact]
    public async Task RemainingDialogWithoutWritePermissionCannotClean()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = UserWithPermissions("database.read"),
            PcCleaningStatistics = PcStats(),
            PcCleaningRemaining = RemainingList(),
        };
        var model = new StatisticsViewModel(api);
        await model.LoadAsync();
        var dialog = await OpenRemainingAsync(api, model);

        // Колонка «Чистка» и подтверждение доступны только при database.write —
        // без права VM помечена CanWrite=false, UI кнопку не показывает.
        Assert.False(dialog.CanWrite);
        Assert.True(dialog.Items[0].CanClean);
    }

    [Fact]
    public async Task RemainingDialogErrorSetsErrorText()
    {
        var api = new FakeHubApiClient
        {
            PcCleaningStatistics = PcStats(),
            PcCleaningRemainingException = new HubApiException(
                HubApiErrorKind.Transport, "network down"),
        };
        var model = new StatisticsViewModel(api);
        await model.LoadAsync();

        model.OpenPcRemainingCommand.Execute(model.PcBranches[0]);
        var dialog = model.PcRemaining!;
        await WaitFor(() => dialog.HasError);

        Assert.True(dialog.HasError);
        Assert.False(dialog.ShowEmpty);
        Assert.Empty(dialog.Items);
    }

    [Fact]
    public async Task ResetClosesRemainingDialog()
    {
        var api = new FakeHubApiClient
        {
            PcCleaningStatistics = PcStats(),
            PcCleaningRemaining = RemainingList(),
        };
        var model = new StatisticsViewModel(api);
        await model.LoadAsync();
        await OpenRemainingAsync(api, model);

        model.Reset();

        Assert.False(model.IsPcRemainingOpen);
        Assert.Null(model.PcRemaining);
    }
}
