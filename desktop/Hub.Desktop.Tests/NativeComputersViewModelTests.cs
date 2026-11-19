using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NativeComputersViewModelTests
{
    // ---- Список и фильтры ----

    [Fact]
    public async Task LoadFillsListAndSendsContractQuery()
    {
        var api = new FakeHubApiClient
        {
            ComputersPage = new HubComputersPage
            {
                Total = 2,
                Items =
                [
                    new HubComputer
                    {
                        MacAddress = "AA:BB:CC:00:00:01",
                        Hostname = "WS-01",
                        Status = "online",
                        AgeSeconds = 120,
                        UserFullName = "Петров Пётр",
                        BranchName = "Сургут",
                        LocationName = "офис 210",
                        IpPrimary = "10.0.0.5",
                    },
                    new HubComputer
                    {
                        MacAddress = "AA:BB:CC:00:00:02",
                        Hostname = "WS-02",
                        Status = "stale",
                        IsUnassigned = true,
                        HasHardwareChanges = true,
                    },
                ],
            },
        };
        var model = new ComputersViewModel(api);

        await model.LoadAsync();

        Assert.Equal(2, model.Items.Count);
        Assert.Equal("WS-01", model.Items[0].Title);
        Assert.Equal("В сети", model.Items[0].StatusText);
        Assert.Equal("success", model.Items[0].StatusTone);
        Assert.Equal("2 мин назад", model.Items[0].AgeText);
        Assert.Equal("Петров Пётр", model.Items[0].UserText);
        Assert.Equal("Сургут · офис 210", model.Items[0].PlaceText);
        Assert.Equal("10.0.0.5", model.Items[0].IpText);
        Assert.True(model.Items[1].IsUnassigned);
        Assert.True(model.Items[1].HasChangesBadge);
        Assert.Equal("Давно не было", model.Items[1].StatusText);
        Assert.Equal("2 компьютера", model.TotalText);
        Assert.False(model.HasBannerError);
        Assert.False(model.HasMore);
        Assert.False(model.IsEmpty);
        // Контракт mobile-клиента: scope/поиск/фильтры/сортировка как в computersApi.ts.
        var query = Assert.Single(api.ComputersQueries);
        Assert.Equal("selected", query.Scope);
        Assert.Null(query.Search);
        Assert.Equal("identity,user,profiles,outlook,network,location,database", query.SearchFields);
        Assert.Null(query.Status);
        Assert.False(query.ChangedOnly);
        Assert.True(query.HideVm172);
        Assert.Equal("hostname", query.SortBy);
        Assert.Equal("asc", query.SortDir);
        Assert.Equal(50, query.Limit);
        Assert.Equal(0, query.Offset);
    }

    [Fact]
    public async Task DiskWarningsAndUnassignedBadgesComeFromContract()
    {
        var api = new FakeHubApiClient
        {
            ComputersPage = PageOf(new HubComputer
            {
                MacAddress = "MAC-1",
                Hostname = "WS-DSK",
                Status = "online",
                LogicalDisks =
                [
                    new HubComputerDisk { Name = "C:", TotalGb = 100, FreeGb = 5, HealthStatus = "ok" },
                ],
                Storage =
                [
                    new HubComputerDisk { Device = "SSD1", HealthStatus = "critical" },
                ],
            }),
        };
        var model = new ComputersViewModel(api);
        await model.LoadAsync();

        var item = model.Items[0];
        Assert.Equal(2, item.DiskWarningCount);
        Assert.True(item.HasDiskBadge);
        Assert.Equal("2 диск.", item.DiskBadgeText);
    }

    [Fact]
    public async Task SearchTextTriggersDebouncedServerSearch()
    {
        var api = new FakeHubApiClient();
        var model = new ComputersViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();

        model.SearchText = "  ws-01  ";
        await WaitFor(() => api.ComputersCallCount == 2);

        Assert.Equal("ws-01", api.ComputersQueries[^1].Search);
        Assert.Equal(0, api.ComputersQueries[^1].Offset);
    }

    [Fact]
    public async Task OneCharSearchDoesNotHitServer()
    {
        var api = new FakeHubApiClient();
        var model = new ComputersViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();

        // Веб: ввод длиной 1 символ поиска не меняет (min query length = 2).
        model.SearchText = "w";
        await Task.Delay(60);

        Assert.Equal(1, api.ComputersCallCount);
    }

    [Fact]
    public async Task ClearingSearchReloadsUnfilteredList()
    {
        var api = new FakeHubApiClient();
        var model = new ComputersViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();

        model.SearchText = "ws";
        await WaitFor(() => api.ComputersCallCount == 2);
        model.SearchText = "";
        await WaitFor(() => api.ComputersCallCount == 3);

        Assert.Null(api.ComputersQueries[^1].Search);
    }

    [Fact]
    public async Task StaleSearchResultDoesNotOverwriteNewerQuery()
    {
        var api = new FakeHubApiClient();
        var gate = new TaskCompletionSource();
        var model = new ComputersViewModel(api)
        {
            DelayAsync = async (_, ct) =>
            {
                await gate.Task;
                ct.ThrowIfCancellationRequested();
            },
        };
        await model.LoadAsync();

        model.SearchText = "w1";
        model.SearchText = "w2";
        gate.SetResult();
        await WaitFor(() => api.ComputersCallCount >= 2);

        // Первая отложенная загрузка отменена — на сервер ушёл только последний запрос.
        Assert.Equal("w2", api.ComputersQueries[^1].Search);
        Assert.DoesNotContain(api.ComputersQueries, query => query.Search == "w1");
    }

    [Fact]
    public async Task StatusFilterAndTogglesReloadWithContractParams()
    {
        var api = new FakeHubApiClient();
        var model = new ComputersViewModel(api);
        await model.LoadAsync();

        model.SelectedStatusFilter = model.StatusFilterOptions[1]; // online
        await WaitFor(() => api.ComputersCallCount == 2);
        Assert.Equal("online", api.ComputersQueries[^1].Status);
        Assert.Equal("В сети", model.SelectedStatusFilterText);

        model.ChangedOnly = true;
        await WaitFor(() => api.ComputersCallCount == 3);
        Assert.True(api.ComputersQueries[^1].ChangedOnly);

        model.HideVm172 = false;
        await WaitFor(() => api.ComputersCallCount == 4);
        Assert.False(api.ComputersQueries[^1].HideVm172);
        Assert.True(api.ComputersQueries[^1].ChangedOnly);
        Assert.Equal("online", api.ComputersQueries[^1].Status);
    }

    [Fact]
    public async Task ScopeAllRequiresReadAllPermission()
    {
        var api = new FakeHubApiClient();
        var model = new ComputersViewModel(api);
        await model.LoadAsync();

        // Без computers.read_all переключателя «Все базы» нет, scope — selected.
        Assert.False(model.ShowScopeFilter);
        Assert.False(model.AllDatabases);
        Assert.Equal("selected", api.ComputersQueries[^1].Scope);

        var adminApi = new FakeHubApiClient
        {
            CurrentUser = new HubUser { Id = 1, Permissions = ["computers.read_all"] },
        };
        var adminModel = new ComputersViewModel(adminApi);
        await adminModel.LoadAsync();

        Assert.True(adminModel.ShowScopeFilter);
        adminModel.AllDatabases = true;
        await WaitFor(() => adminApi.ComputersCallCount == 2);
        Assert.Equal("all", adminApi.ComputersQueries[^1].Scope);
    }

    [Fact]
    public async Task ClearFiltersRestoresDefaultsAndReloads()
    {
        var api = new FakeHubApiClient();
        var model = new ComputersViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        model.SelectedStatusFilter = model.StatusFilterOptions[2];
        await WaitFor(() => api.ComputersCallCount == 2);
        model.ChangedOnly = true;
        await WaitFor(() => api.ComputersCallCount == 3);
        model.SearchText = "ws";
        await WaitFor(() => api.ComputersCallCount == 4);
        Assert.True(model.HasActiveFilters);

        model.ClearFiltersCommand.Execute(null);
        await WaitFor(() => api.ComputersCallCount == 5);

        Assert.False(model.HasActiveFilters);
        Assert.Equal(string.Empty, model.SearchText);
        Assert.Null(model.SelectedStatusFilter.Value);
        Assert.False(model.ChangedOnly);
        Assert.Null(api.ComputersQueries[^1].Status);
        Assert.Null(api.ComputersQueries[^1].Search);
        Assert.False(api.ComputersQueries[^1].ChangedOnly);
        // hide_vm_172 — дефолтная серверная опция, сброс её не трогает.
        Assert.True(api.ComputersQueries[^1].HideVm172);
    }

    // ---- Пагинация «Показать ещё» (серверный offset) ----

    [Fact]
    public async Task LoadMoreAppendsNextOffsetPortion()
    {
        var api = new FakeHubApiClient
        {
            ComputersPageFactory = query => query.Offset == 0
                ? new HubComputersPage
                {
                    Total = 3,
                    Limit = 2,
                    Offset = 0,
                    HasMore = true,
                    NextOffset = 2,
                    Items =
                    [
                        Computer("MAC-1", "WS-01"),
                        Computer("MAC-2", "WS-02"),
                    ],
                }
                : new HubComputersPage
                {
                    Total = 3,
                    Limit = 2,
                    Offset = 2,
                    HasMore = false,
                    Items = [Computer("MAC-3", "WS-03")],
                },
        };
        var model = new ComputersViewModel(api);
        await model.LoadAsync();

        Assert.Equal(2, model.Items.Count);
        Assert.True(model.HasMore);
        Assert.Equal("Показать ещё (1)", model.MoreButtonText);
        Assert.Equal("3 компьютера", model.TotalText);

        await ((NativeAsyncCommand)model.LoadMoreCommand).ExecuteAsync(null);

        Assert.Equal(3, model.Items.Count);
        Assert.Equal("WS-03", model.Items[2].Title);
        Assert.False(model.HasMore);
        var pageQuery = api.ComputersQueries[^1];
        Assert.Equal(2, pageQuery.Offset);
        Assert.Equal(2, api.ComputersCallCount);
    }

    [Fact]
    public async Task LoadMoreDeduplicatesByMac()
    {
        var api = new FakeHubApiClient
        {
            ComputersPageFactory = query => query.Offset == 0
                ? new HubComputersPage
                {
                    Total = 2,
                    HasMore = true,
                    NextOffset = 1,
                    Items = [Computer("MAC-1", "WS-01")],
                }
                : new HubComputersPage
                {
                    Total = 2,
                    HasMore = false,
                    Items = [Computer("MAC-1", "WS-01"), Computer("MAC-2", "WS-02")],
                },
        };
        var model = new ComputersViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.LoadMoreCommand).ExecuteAsync(null);

        // mergeComputerPage: повторный MAC не дублирует строку.
        Assert.Equal(2, model.Items.Count);
    }

    // ---- Карточка ----

    [Fact]
    public async Task SelectingComputerLoadsDetailByMac()
    {
        var api = new FakeHubApiClient
        {
            ComputersPage = PageOf(Computer("AA:BB:CC:00:00:01", "WS-01")),
            ComputerDetail = Detail(),
        };
        var model = new ComputersViewModel(api);
        await model.LoadAsync();
        Assert.True(model.ShowDetailPlaceholder);

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        var detail = model.Detail!;
        Assert.Equal("WS-01", detail.Title);
        Assert.Equal("В сети", detail.StatusText);
        Assert.Equal("Петров Пётр", detail.UserText);
        Assert.Equal("Сургут", detail.BranchText);
        Assert.Equal("офис 210", detail.LocationText);
        Assert.Equal("ITINVENT", detail.DatabaseText);
        Assert.Equal("100234", detail.InventoryText);
        Assert.Equal("ThinkCentre M70", detail.InventoryModelText);
        Assert.Equal("Intel i7-10700", detail.CpuText);
        Assert.Equal("16 ГБ", detail.RamText);
        Assert.Equal("25%", detail.CpuLoadText);
        Assert.Equal("61%", detail.RamUsedText);
        Assert.Equal("2 дн 3 ч", detail.UptimeText);
        Assert.Equal("SN-7788", detail.SystemSerialText);
        Assert.Equal("10.0.0.5", detail.IpPrimaryText);
        Assert.Contains("10.0.0.6", detail.IpListText);
        Assert.Equal("AA:BB:CC:00:00:01", detail.MacAddress);
        Assert.Single(detail.NetworkDevices);
        Assert.Equal("Ethernet0", detail.NetworkDevices[0].Title);
        Assert.Equal(2, detail.Disks.Count);
        Assert.Equal(1, detail.DiskWarningCount);
        Assert.Equal("В норме", detail.OutlookStatusText);
        Assert.Equal("1,5 ГБ", detail.OutlookSizeText);
        Assert.Equal("3", detail.OutlookArchivesText);
        Assert.Equal("4", detail.ChangesCountText);
        var call = Assert.Single(api.ComputerDetailCalls);
        Assert.Equal("AA:BB:CC:00:00:01", call.MacAddress);
        Assert.Equal("selected", call.Scope);
    }

    [Fact]
    public async Task DetailScopeFollowsAllDatabasesToggle()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = new HubUser { Id = 1, Permissions = ["computers.read_all"] },
            ComputersPage = PageOf(Computer("MAC-1", "WS-01")),
            ComputerDetail = Detail(),
        };
        var model = new ComputersViewModel(api);
        await model.LoadAsync();
        model.AllDatabases = true;
        await WaitFor(() => api.ComputersCallCount == 2);

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        Assert.Equal("all", api.ComputerDetailCalls[^1].Scope);
    }

    [Fact]
    public async Task ComputerSwitchKeepsOnlyLatestDetail()
    {
        var api = new FakeHubApiClient
        {
            ComputersPage = PageOf(
                Computer("MAC-1", "WS-01"),
                Computer("MAC-2", "WS-02")),
            ComputerDetailFactory = mac => new HubComputer { MacAddress = mac, Hostname = "Host-" + mac },
        };
        var model = new ComputersViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        model.SelectedItem = model.Items[1];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        Assert.Equal("MAC-2", model.Detail?.MacAddress);
        Assert.Equal("Host-MAC-2", model.Detail?.Title);
    }

    [Fact]
    public async Task StaleDetailResultDoesNotOverwriteNewSelection()
    {
        var gates = new Dictionary<string, TaskCompletionSource>
        {
            ["MAC-1"] = new(),
            ["MAC-2"] = new(),
        };
        var api = new FakeHubApiClient
        {
            ComputersPage = PageOf(
                Computer("MAC-1", "WS-01"),
                Computer("MAC-2", "WS-02")),
            ComputerDetailFactory = mac => new HubComputer { MacAddress = mac, Hostname = "Host-" + mac },
            ComputerDetailDelay = async (mac, ct) =>
            {
                await gates[mac].Task;
                ct.ThrowIfCancellationRequested();
            },
        };
        var model = new ComputersViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        model.SelectedItem = model.Items[1];
        // Первый ответ приходит уже после смены выбора — карточку он трогать не должен.
        gates["MAC-1"].SetResult();
        gates["MAC-2"].SetResult();
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        Assert.Equal("MAC-2", model.Detail?.MacAddress);
    }

    // ---- Ошибки и сброс ----

    [Fact]
    public async Task ListErrorGoesToBannerAndShowsEmptyState()
    {
        var api = new FakeHubApiClient
        {
            ComputersException = new HttpRequestException("network down"),
        };
        var model = new ComputersViewModel(api);

        await Assert.ThrowsAsync<HttpRequestException>(() => model.LoadAsync());
        // Шелл сам кладёт ошибку в баннер (как у остальных страниц).
        model.SetLoadError(TasksViewModel.DescribeError(new HttpRequestException("network down")));

        Assert.True(model.HasBannerError);
        Assert.False(model.IsLoading);
        Assert.False(model.IsEmpty);
    }

    [Fact]
    public async Task DetailErrorGoesToCardErrorNotBanner()
    {
        var api = new FakeHubApiClient
        {
            ComputersPage = PageOf(Computer("MAC-1", "WS-01")),
            ComputerDetailException = new HttpRequestException("404"),
        };
        var model = new ComputersViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.HasDetailError || !model.IsDetailLoading);

        Assert.True(model.HasDetailError);
        Assert.False(model.HasBannerError);
        Assert.Null(model.Detail);
    }

    [Fact]
    public async Task EmptyResultShowsEmptyState()
    {
        var api = new FakeHubApiClient
        {
            ComputersPage = new HubComputersPage { Items = [], Total = 0 },
        };
        var model = new ComputersViewModel(api);

        await model.LoadAsync();

        Assert.True(model.IsEmpty);
        Assert.Equal("0 компьютеров", model.TotalText);
        Assert.False(model.HasBannerError);
    }

    [Fact]
    public async Task ResetClearsListDetailFiltersAndPendingSearch()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = new HubUser { Id = 1, Permissions = ["computers.read_all"] },
            ComputersPage = PageOf(Computer("MAC-1", "WS-01"), Computer("MAC-2", "WS-02")),
            ComputerDetail = Detail(),
        };
        var gate = new TaskCompletionSource();
        var model = new ComputersViewModel(api)
        {
            DelayAsync = async (_, ct) =>
            {
                await gate.Task;
                ct.ThrowIfCancellationRequested();
            },
        };
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);
        model.SelectedStatusFilter = model.StatusFilterOptions[1];
        await WaitFor(() => api.ComputersCallCount == 2);
        model.ChangedOnly = true;
        await WaitFor(() => api.ComputersCallCount == 3);

        model.SearchText = "ws";
        model.Reset();
        gate.SetResult();

        Assert.Empty(model.Items);
        Assert.Null(model.SelectedItem);
        Assert.Null(model.Detail);
        Assert.True(model.ShowDetailPlaceholder);
        Assert.Equal(string.Empty, model.SearchText);
        Assert.Null(model.SelectedStatusFilter.Value);
        Assert.False(model.ChangedOnly);
        Assert.True(model.HideVm172);
        Assert.False(model.AllDatabases);
        Assert.False(model.ShowScopeFilter);
        Assert.False(model.HasMore);
        Assert.False(model.HasBannerError);
        Assert.Equal(string.Empty, model.TotalText);
        Assert.Equal(string.Empty, model.LastUpdatedText);
        // Отложенный поиск отменён — новых вызовов списка нет.
        await Task.Delay(50);
        Assert.Equal(3, api.ComputersCallCount);
    }

    // ---- Форматирование ----

    [Fact]
    public void ItemViewModelToleratesSparseRecord()
    {
        var item = new ComputerItemViewModel(new HubComputer());

        Assert.Equal("Неизвестный ПК", item.Title);
        Assert.Equal("Неизвестно", item.StatusText);
        Assert.Equal("muted", item.StatusTone);
        Assert.Equal("давность неизвестна", item.AgeText);
        Assert.False(item.HasUser);
        Assert.False(item.HasPlace);
        Assert.False(item.HasIp);
        Assert.False(item.HasDiskBadge);
        Assert.False(item.HasChangesBadge);
    }

    [Fact]
    public void DetailViewModelToleratesSparseRecord()
    {
        var detail = new ComputerDetailViewModel(new HubComputer());

        Assert.Equal("Компьютер", detail.Title);
        Assert.Equal("—", detail.CpuText);
        Assert.Equal("—", detail.RamText);
        Assert.Equal("—", detail.OutlookStatusText);
        Assert.Equal("Нет данных", detail.LastSeenText);
        Assert.Equal("Нет данных", detail.UptimeText);
        Assert.Empty(detail.Disks);
        Assert.Empty(detail.NetworkDevices);
        Assert.False(detail.HasDisks);
        Assert.False(detail.HasNetworkDevices);
    }

    [Fact]
    public void CatalogFormatsAgeUptimeAndBytes()
    {
        Assert.Equal("только что", ComputerCatalog.FormatAge(30));
        Assert.Equal("5 мин назад", ComputerCatalog.FormatAge(300));
        Assert.Equal("2 ч назад", ComputerCatalog.FormatAge(7200));
        Assert.Equal("3 дн назад", ComputerCatalog.FormatAge(3 * 86400));
        Assert.Equal("давность неизвестна", ComputerCatalog.FormatAge(null));
        Assert.Equal("4 ч", ComputerCatalog.FormatUptime(4 * 3600 + 600));
        Assert.Equal("1 дн 2 ч", ComputerCatalog.FormatUptime(86400 + 7200));
        Assert.Equal("Нет данных", ComputerCatalog.FormatUptime(null));
        Assert.Equal("512 Б", ComputerCatalog.FormatBytes(512));
        Assert.Equal("1,5 МБ", ComputerCatalog.FormatBytes(1536 * 1024));
        Assert.Equal("Нет данных", ComputerCatalog.FormatBytes(null));
        Assert.Equal("Нет данных", ComputerCatalog.FormatTimestamp(null));
        Assert.NotEqual("Нет данных", ComputerCatalog.FormatTimestamp(1_700_000_000));
    }

    private static HubComputer Computer(string mac, string hostname) => new()
    {
        MacAddress = mac,
        Hostname = hostname,
        Status = "online",
        AgeSeconds = 60,
    };

    private static HubComputersPage PageOf(params HubComputer[] items) => new()
    {
        Items = items,
        Total = items.Length,
        Limit = 50,
        Offset = 0,
        HasMore = false,
    };

    private static HubComputer Detail() => new()
    {
        MacAddress = "AA:BB:CC:00:00:01",
        Hostname = "WS-01",
        Status = "online",
        AgeSeconds = 60,
        LastSeenAt = 1_700_000_000,
        UserFullName = "Петров Пётр",
        BranchName = "Сургут",
        LocationName = "офис 210",
        DatabaseName = "ITINVENT",
        InventoryInvNo = "100234",
        InventoryModelName = "ThinkCentre M70",
        IpPrimary = "10.0.0.5",
        IpList = ["10.0.0.5", "10.0.0.6"],
        CpuModel = "Intel i7-10700",
        CpuLoadPercent = 25,
        RamGb = 16,
        RamUsedPercent = 61,
        SystemSerial = "SN-7788",
        UptimeSeconds = 2 * 86400 + 3 * 3600,
        LastRebootAt = 1_699_000_000,
        OutlookStatus = "ok",
        OutlookTotalSizeBytes = 1_610_612_736, // 1,5 ГБ
        OutlookArchivesCount = 3,
        HasHardwareChanges = true,
        ChangesCount30d = 4,
        LogicalDisks =
        [
            new HubComputerDisk
            {
                Name = "C:",
                Mountpoint = "C:",
                TotalGb = 200,
                FreeGb = 150,
                HealthStatus = "ok",
            },
        ],
        Storage =
        [
            new HubComputerDisk
            {
                Device = "SSD1",
                MediaType = "ssd",
                SizeGb = 476,
                HealthStatus = "warning",
            },
        ],
        Network = new HubComputerNetwork
        {
            Devices =
            [
                new HubComputerNetworkDevice
                {
                    Name = "Ethernet0",
                    ConnectionStatus = "connected",
                    LinkSpeed = "1 Гбит/с",
                    Ipv4 = ["10.0.0.5"],
                },
            ],
        },
    };

    private static async Task WaitFor(Func<bool> condition, TimeSpan? timeout = null)
    {
        var deadline = DateTime.UtcNow + (timeout ?? TimeSpan.FromSeconds(5));
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
}
