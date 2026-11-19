using System.Net;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NativeMfuViewModelTests
{
    private static string Now() => DateTimeOffset.UtcNow.ToString("o");

    private static HubMfuDevice Device(
        string key,
        string model,
        string pingStatus = "online",
        string snmpStatus = "ok",
        int? supplyPercent = 80,
        long? pageTotal = 1200) => new()
    {
        Key = key,
        Id = key.Split('|').Last(),
        InvNo = "INV-" + key.Split('|').Last(),
        SerialNo = "SN-" + key.Split('|').Last(),
        HwSerialNo = "HW-" + key.Split('|').Last(),
        TypeName = "МФУ",
        ModelName = model,
        Manufacturer = "HP",
        BranchName = "ЦО",
        LocationName = "Кабинет 101",
        Status = "В работе",
        IpAddress = "10.0.0.10",
        Hostname = "printer-" + key.Split('|').Last(),
        MacAddress = "AA:BB:CC:DD:EE:FF",
        EmployeeName = "Иванов И.И.",
        EmployeeDept = "Бухгалтерия",
        Runtime = new HubMfuRuntime
        {
            Ping = new HubMfuPing
            {
                Status = pingStatus,
                LatencyMs = 4,
                CheckedAt = Now(),
                LastOnlineAt = Now(),
            },
            Snmp = new HubMfuSnmp
            {
                Status = snmpStatus,
                CheckedAt = Now(),
                LastSuccessAt = Now(),
                BestPercent = supplyPercent,
                PageTotal = pageTotal,
                Version = "v2c",
                Supplies = supplyPercent is null
                    ? []
                    : [new HubMfuSupply { Index = 1, Name = "Black Toner Cartridge", Level = 8, Max = 10, Percent = supplyPercent }],
                Trays = [new HubMfuTray { Index = 1, Name = "Tray 1", MediaName = "A4", CurrentLevel = 200, MaxCapacity = 250, Percent = 80 }],
                DeviceInfo = new HubMfuDeviceInfo
                {
                    SysName = "printer-main",
                    SysDescr = "HP LaserJet",
                    DeviceModel = "M404",
                    SerialNumber = "SNMP-SN-1",
                    SysLocation = "Кабинет 101",
                    UptimeSeconds = 90000,
                },
                CustomMetrics = new Dictionary<string, string> { ["Температура"] = "35 C" },
            },
        },
        Maintenance = new HubMfuMaintenance
        {
            TotalOperations = 3,
            LastOperationAt = Now(),
            Recent =
            [
                new HubMfuMaintenanceEvent
                {
                    Timestamp = Now(),
                    ComponentType = "cartridge",
                    ReplacementItem = "Black Toner Cartridge;SND2007300170C0000",
                    Employee = "Петров П.П.",
                },
            ],
        },
    };

    private static HubMfuDeviceList Payload(params (string Branch, string Location, HubMfuDevice Device)[] rows) => new()
    {
        GeneratedAt = Now(),
        DbId = "main",
        Totals = new HubMfuTotals
        {
            Devices = rows.Length,
            Online = rows.Count(r => r.Device.Runtime?.Ping?.Status == "online"),
            Offline = rows.Count(r => r.Device.Runtime?.Ping?.Status == "offline"),
            SnmpOk = 2,
            SnmpFresh = 1,
            SnmpCachedActive = 1,
            SnmpError = 0,
            SnmpUnknown = 0,
            SnmpActiveTtlSec = 1800,
        },
        Grouped = rows
            .GroupBy(r => r.Branch)
            .ToDictionary(
                g => g.Key,
                g => g
                    .GroupBy(r => r.Location)
                    .ToDictionary(l => l.Key, l => l.Select(r => r.Device).ToList())),
    };

    private static IEnumerable<MfuDeviceItemViewModel> Devices(MfuViewModel model) =>
        model.Items.OfType<MfuDeviceItemViewModel>();

    // ---- Список ----

    [Fact]
    public async Task LoadFillsGroupedListWithCountersAndWorksSummary()
    {
        var api = new FakeHubApiClient
        {
            MfuDevices = Payload(
                ("ЦО", "Кабинет 101", Device("main|1", "HP LaserJet M404", "online", "ok", 80)),
                ("ЦО", "Кабинет 101", Device("main|2", "Kyocera ECOSYS", "offline", "error", 10))),
            MfuWorksStatistics = new HubMfuWorksStatistics
            {
                PeriodDays = 90,
                Totals = new HubMfuWorksTotals { TotalOperations = 7, UniqueBranches = 2, UniqueLocations = 4 },
                ByTypePeriod = new Dictionary<string, int> { ["Картридж"] = 5, ["Фьюзер (печка)"] = 2 },
            },
        };
        var model = new MfuViewModel(api);

        await model.LoadAsync();

        // Список сгруппирован: филиал → локация → устройства.
        Assert.IsType<MfuBranchRow>(model.Items[0]);
        var branch = (MfuBranchRow)model.Items[0];
        Assert.Equal("ЦО", branch.Title);
        Assert.Equal("2 устройства", branch.CountText);
        Assert.Equal("1 локация", branch.LocationsText);
        var location = Assert.IsType<MfuLocationRow>(model.Items[1]);
        Assert.Equal("2 шт", location.CountText);
        Assert.Equal("Online: 1", location.OnlineText);
        Assert.Equal("Offline: 1", location.OfflineText);
        var devices = Devices(model).ToList();
        Assert.Equal(2, devices.Count);
        // Критичный тонер (10 < 20) вперёд — как сортировка веба.
        Assert.Equal("Kyocera ECOSYS", devices[0].Title);
        Assert.True(devices[0].IsLowToner);
        Assert.Equal("Оффлайн", devices[0].PingStatusText);
        Assert.Equal("error", devices[0].PingTone);
        Assert.Equal("В сети", devices[1].PingStatusText);
        Assert.Equal("success", devices[1].PingTone);
        Assert.Equal("Страниц: 1200", devices[1].PagesText);
        Assert.Equal("Работ: 3", devices[1].WorksText);

        // Счётчики и подписи из totals — как StatCard-ряд веба.
        Assert.Equal("2", model.DevicesTotalText);
        Assert.Equal("1", model.OnlineTotalText);
        Assert.Equal("1", model.OfflineTotalText);
        Assert.Equal("2", model.SnmpOkTotalText);
        Assert.Equal("свежие: 1, кэш: 1, TTL: 30 мин", model.SnmpMetricHelperText);
        Assert.Equal("ошибки: 0, неизвестно: 0", model.SnmpDetailHelperText);
        Assert.Equal("БД: main", model.DbIdText);
        Assert.StartsWith("Обновлено:", model.GeneratedAtText);

        // Опции фильтра филиалов — «Все» + филиалы выдачи.
        Assert.Equal(2, model.BranchFilterOptions.Count);
        Assert.Equal("Все", model.BranchFilterOptions[0].Label);
        Assert.Equal("ЦО", model.BranchFilterOptions[1].Label);

        // Статистика работ — сводка + топ типов.
        Assert.Equal("Работ за 90 дн.: 7 · филиалов: 2 · локаций: 4", model.WorksSummaryText);
        Assert.Equal("По типам: Картридж — 5 · Фьюзер (печка) — 2", model.WorksTopTypesText);

        Assert.False(model.HasBannerError);
        Assert.False(model.IsEmpty);
        Assert.False(model.ShowZeroDevicesNotice);
        Assert.Equal([(365, 8, 5000)], api.MfuDevicesCalls);
        Assert.Equal(1, api.MfuWorksStatisticsCallCount);
    }

    [Fact]
    public async Task SearchAndFiltersWorkLocally()
    {
        var api = new FakeHubApiClient
        {
            MfuDevices = Payload(
                ("ЦО", "101", Device("main|1", "HP LaserJet", "online", "ok", 80)),
                ("Юг", "202", Device("main|2", "Kyocera", "offline", "error", 5))),
        };
        var model = new MfuViewModel(api);
        await model.LoadAsync();

        // Поиск по blob полей (модель/серийный/IP).
        model.SearchText = "kyocera";
        Assert.Single(Devices(model));
        Assert.Equal("Kyocera", Devices(model).First().Title);

        model.SearchText = "sn-1";
        Assert.Single(Devices(model));
        Assert.Equal("HP LaserJet", Devices(model).First().Title);

        model.SearchText = "10.0.0.10";
        Assert.Equal(2, Devices(model).Count());

        model.SearchText = "иванов";
        Assert.Equal(2, Devices(model).Count());

        model.SearchText = string.Empty;

        // Филиал: «Юг» — только его строки.
        model.SelectedBranchFilter = model.BranchFilterOptions.First(o => o.Value == "Юг");
        Assert.Single(Devices(model));
        Assert.Equal("Kyocera", Devices(model).First().Title);
        model.SelectedBranchFilter = MfuViewModel.AllBranches;

        // Сеть: только «Оффлайн».
        model.SelectedPingFilter = model.PingFilterOptions.First(o => o.Value == "offline");
        Assert.Single(Devices(model));
        Assert.Equal("Kyocera", Devices(model).First().Title);
        model.SelectedPingFilter = MfuViewModel.AllPings;

        // SNMP low_toner — тонер < 20%.
        model.SelectedSnmpFilter = model.SnmpFilterOptions.First(o => o.Value == "low_toner");
        Assert.Single(Devices(model));
        Assert.Equal("Kyocera", Devices(model).First().Title);

        // SNMP error — по статусу опроса.
        model.SelectedSnmpFilter = model.SnmpFilterOptions.First(o => o.Value == "error");
        Assert.Single(Devices(model));
        model.SelectedSnmpFilter = MfuViewModel.AllSnmp;

        Assert.Equal("2 устройства", model.FilteredSummaryText);
        // Локальные фильтры — повторных запросов нет.
        Assert.Equal(1, api.MfuDevicesCallCount);
    }

    [Fact]
    public async Task EmptyPayloadShowsEmptyStateAndZeroDevicesNotice()
    {
        var api = new FakeHubApiClient
        {
            MfuDevices = new HubMfuDeviceList
            {
                Totals = new HubMfuTotals(),
                Grouped = new Dictionary<string, Dictionary<string, List<HubMfuDevice>>>(),
            },
        };
        var model = new MfuViewModel(api);

        await model.LoadAsync();

        Assert.Empty(model.Items);
        Assert.True(model.IsEmpty);
        Assert.Equal("0", model.DevicesTotalText);
        Assert.True(model.ShowZeroDevicesNotice);
        Assert.Equal("0 устройств", model.FilteredSummaryText);
    }

    // ---- Деталь и помесячная печать ----

    [Fact]
    public async Task SelectingDeviceBuildsDetailAndLoadsMonthlyPages()
    {
        var api = new FakeHubApiClient
        {
            MfuDevices = Payload(("ЦО", "101", Device("main|1", "HP LaserJet M404"))),
            MfuMonthlyPages = new HubMfuMonthlyPages
            {
                DeviceKey = "main|1",
                CurrentTotalPages = 1200,
                CurrentCheckedAt = Now(),
                TrackingStartDate = "2026-01-01",
                Months =
                [
                    new HubMfuMonthPages { Month = "2026-02", PrintedPages = 300, StartCounter = 900, EndCounter = 1200 },
                    new HubMfuMonthPages { Month = "2026-01", PrintedPages = 100, ResetDetected = true },
                ],
            },
        };
        var model = new MfuViewModel(api);
        await model.LoadAsync();

        model.SelectedDevice = Devices(model).First();
        await WaitFor(() => model.Detail is { MonthlyItems.Count: > 0 });

        var detail = model.Detail!;
        Assert.Equal("HP LaserJet M404", detail.Title);
        Assert.Equal("МФУ", detail.SubtitleText);
        Assert.Equal("HP", detail.ManufacturerText);
        Assert.Equal("В сети", detail.PingStatusText);
        Assert.Equal("Инв. номер: INV-1", detail.InvNoText);
        Assert.Equal("Серийный: SN-1", detail.SerialText);
        Assert.Equal("HW серийный: HW-1", detail.HwSerialText);
        Assert.Equal("IP: 10.0.0.10", detail.IpText);
        Assert.Equal("MAC: AA:BB:CC:DD:EE:FF", detail.MacText);
        Assert.Equal("Филиал: ЦО", detail.BranchText);
        Assert.Equal("Локация: Кабинет 101", detail.LocationText);
        Assert.Equal("Сотрудник: Иванов И.И.", detail.EmployeeText);
        Assert.Equal("Отдел: Бухгалтерия", detail.DeptText);
        Assert.StartsWith("Последняя проверка:", detail.PingCheckedText);
        Assert.Equal("Задержка: 4 мс", detail.PingLatencyText);
        Assert.Equal("ok", detail.SnmpStatusText);
        Assert.Equal("Версия SNMP: v2c", detail.SnmpVersionText);

        // Расходники: группа «Картриджи / Тонеры», имя нормализовано в «Тонер-картридж».
        var group = Assert.Single(detail.SupplyGroups);
        Assert.Equal("Картриджи / Тонеры", group.Title);
        var supply = Assert.Single(group.Items);
        Assert.Equal("Black Тонер-картридж", supply.Name);
        Assert.Equal("Уровень: 8 / 10; 80%", supply.LevelText);
        Assert.False(supply.IsLow);

        // Информация SNMP и лоток.
        Assert.True(detail.HasDeviceInfo);
        Assert.Equal("Серийный №: SNMP-SN-1", detail.DeviceSerialText);
        Assert.Equal("Uptime: 1д 1ч 0м", detail.UptimeText);
        Assert.Single(detail.CustomMetrics);
        var tray = Assert.Single(detail.Trays);
        Assert.Equal("Tray 1", tray.Name);
        Assert.Equal("Бумага: A4; Уровень: 200 / 250", tray.LevelText);

        // Помесячная печать — догружена отдельным запросом.
        Assert.Equal(["main|1"], api.MfuMonthlyPagesCalls);
        Assert.Equal(2, detail.MonthlyItems.Count);
        Assert.Equal("02.2026: 300 стр.", detail.MonthlyItems[0].TitleText);
        Assert.Equal("Счетчик: 900 → 1200", detail.MonthlyItems[0].DetailText);
        Assert.True(detail.MonthlyItems[1].HasReset);
        Assert.Equal("Обнаружен сброс счетчика", detail.MonthlyItems[1].DetailText);
        Assert.Equal("Текущий: 1200", detail.CurrentPagesText);
        Assert.Equal("Начало учета: 01.01.2026", detail.TrackingStartText);

        // История работ: тип и имя нормализованы, SND-суффикс срезан.
        Assert.Equal("3", detail.MaintenanceTotalText);
        var work = Assert.Single(detail.MaintenanceItems);
        Assert.Equal("Картридж: Black Тонер-картридж", work.TitleText);
        Assert.Contains("Петров П.П.", work.DetailText);
    }

    [Fact]
    public async Task MonthlyPagesErrorShowsSectionErrorNotBanner()
    {
        var api = new FakeHubApiClient
        {
            MfuDevices = Payload(("ЦО", "101", Device("main|1", "HP"))),
            MfuMonthlyPagesException = new HubApiException(
                HubApiErrorKind.Http, "forbidden", HttpStatusCode.Forbidden),
        };
        var model = new MfuViewModel(api);
        await model.LoadAsync();

        model.SelectedDevice = Devices(model).First();
        await WaitFor(() => model.Detail?.HasMonthlyError == true);

        Assert.Equal("Недостаточно прав для этого действия.", model.Detail!.MonthlyErrorText);
        Assert.False(model.Detail.IsMonthlyLoading);
        // Секция-локальная ошибка: баннер списка чист.
        Assert.False(model.HasBannerError);
    }

    [Fact]
    public async Task MonthlyPagesAreCachedPerDeviceAndForcedByRefresh()
    {
        var api = new FakeHubApiClient
        {
            MfuDevices = Payload(("ЦО", "101", Device("main|1", "HP"))),
            MfuMonthlyPages = new HubMfuMonthlyPages
            {
                DeviceKey = "main|1",
                Months = [new HubMfuMonthPages { Month = "2026-02", PrintedPages = 10 }],
            },
        };
        var model = new MfuViewModel(api);
        await model.LoadAsync();
        model.SelectedDevice = Devices(model).First();
        await WaitFor(() => model.Detail is { MonthlyItems.Count: > 0 });
        Assert.Single(api.MfuMonthlyPagesCalls);

        // Повторный выбор — из кэша, без запроса.
        model.SelectedDevice = null;
        model.SelectedDevice = Devices(model).First();
        await WaitFor(() => model.Detail is { MonthlyItems.Count: > 0 });
        Assert.Single(api.MfuMonthlyPagesCalls);

        // «Обновить» — принудительный перезапрос.
        await ((NativeAsyncCommand)model.RefreshMonthlyCommand).ExecuteAsync(null);
        Assert.Equal(2, api.MfuMonthlyPagesCalls.Count);
    }

    [Fact]
    public async Task WorksStatisticsFailureIsSilent()
    {
        var api = new FakeHubApiClient
        {
            MfuDevices = Payload(("ЦО", "101", Device("main|1", "HP"))),
            MfuWorksStatisticsException = new HubApiException(
                HubApiErrorKind.Http, "forbidden", HttpStatusCode.Forbidden),
        };
        var model = new MfuViewModel(api);

        await model.LoadAsync();

        // Статистика работ — вторичный виджет: список жив, сводки нет.
        Assert.Single(Devices(model));
        Assert.False(model.HasBannerError);
        Assert.False(model.HasWorksSummary);
    }

    // ---- Ошибка и сброс ----

    [Fact]
    public async Task DevicesLoadErrorShowsBanner()
    {
        var api = new FakeHubApiClient
        {
            MfuDevicesException = new HubApiException(
                HubApiErrorKind.Http, "forbidden", HttpStatusCode.Forbidden),
        };
        var model = new MfuViewModel(api);

        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);

        Assert.Equal("Недостаточно прав для этого действия.", model.BannerErrorText);
        Assert.True(model.HasBannerError);
        Assert.False(model.IsLoading);

        model.DismissBannerCommand.Execute(null);
        Assert.False(model.HasBannerError);
    }

    [Fact]
    public void SetLoadErrorShowsBannerAndStopsLoading()
    {
        var model = new MfuViewModel(new FakeHubApiClient());

        model.SetLoadError("Сессия истекла. Войдите заново.");

        Assert.Equal("Сессия истекла. Войдите заново.", model.BannerErrorText);
        Assert.True(model.HasBannerError);
        Assert.False(model.IsLoading);
    }

    [Fact]
    public async Task ResetClearsState()
    {
        var api = new FakeHubApiClient
        {
            MfuDevices = Payload(("ЦО", "101", Device("main|1", "HP"))),
            MfuMonthlyPages = new HubMfuMonthlyPages
            {
                DeviceKey = "main|1",
                Months = [new HubMfuMonthPages { Month = "2026-02", PrintedPages = 10 }],
            },
            MfuWorksStatistics = new HubMfuWorksStatistics
            {
                Totals = new HubMfuWorksTotals { TotalOperations = 1 },
            },
        };
        var model = new MfuViewModel(api);
        await model.LoadAsync();
        model.SelectedDevice = Devices(model).First();
        await WaitFor(() => model.Detail is { MonthlyItems.Count: > 0 });
        model.SearchText = "hp";
        model.SelectedPingFilter = model.PingFilterOptions.First(o => o.Value == "online");
        model.IsDetailedView = true;

        model.Reset();

        Assert.Empty(model.Items);
        Assert.Null(model.Detail);
        Assert.Null(model.SelectedDevice);
        Assert.True(model.ShowDetailPlaceholder);
        Assert.Equal(string.Empty, model.SearchText);
        Assert.Equal(MfuViewModel.AllBranches, model.SelectedBranchFilter);
        Assert.Equal(MfuViewModel.AllPings, model.SelectedPingFilter);
        Assert.Equal(MfuViewModel.AllSnmp, model.SelectedSnmpFilter);
        Assert.False(model.IsDetailedView);
        Assert.Single(model.BranchFilterOptions);
        Assert.Equal("0", model.DevicesTotalText);
        Assert.Equal(string.Empty, model.SnmpMetricHelperText);
        Assert.Equal(string.Empty, model.GeneratedAtText);
        Assert.Equal(string.Empty, model.DbIdText);
        Assert.False(model.HasWorksSummary);
        Assert.False(model.HasBannerError);
        Assert.False(model.IsLoading);
        Assert.True(model.IsEmpty);
        // После сброса totals=0 — уведомление «0 устройств» показывается (как в вебе).
        Assert.True(model.ShowZeroDevicesNotice);
    }

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
}
