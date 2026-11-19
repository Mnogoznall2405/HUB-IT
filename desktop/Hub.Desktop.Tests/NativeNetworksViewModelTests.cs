using System.Net;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NativeNetworksViewModelTests
{
    // ---- Список филиалов ----

    [Fact]
    public async Task LoadFillsBranchListWithWebLikeChips()
    {
        var api = new FakeHubApiClient
        {
            NetworkBranches = new HubNetworkBranchList
            {
                Branches =
                [
                    new HubNetworkBranch
                    {
                        Id = 1,
                        CityCode = "tmn",
                        BranchCode = "tmn-p19-21",
                        Name = "Первомайская 19/21",
                        DefaultSiteCode = "P19",
                        DbId = "ITINVENT",
                        DevicesCount = 4,
                        PortsCount = 96,
                        OccupiedPorts = 40,
                        SocketsCount = 80,
                        MapsCount = 2,
                        MapPointsCount = 15,
                    },
                    new HubNetworkBranch
                    {
                        Id = 2,
                        CityCode = "tmn",
                        BranchCode = "tmn-resp",
                        Name = "Республики 142",
                        DevicesCount = 1,
                    },
                ],
            },
        };
        var model = new NetworksViewModel(api);

        await model.LoadAsync();

        Assert.Equal(2, model.Items.Count);
        var first = model.Items[0];
        Assert.Equal("Первомайская 19/21", first.Title);
        Assert.Equal("tmn-p19-21", first.CodeText);
        Assert.Equal("Уст: 4", first.DevicesChipText);
        Assert.Equal("Порты: 96", first.PortsChipText);
        Assert.Equal("Роз: 80", first.SocketsChipText);
        Assert.Equal("Карты: 2", first.MapsChipText);
        Assert.Equal("Точ: 15", first.PointsChipText);
        Assert.Equal("Код сайта: P19", first.SiteCodeText);
        Assert.Equal(string.Empty, model.Items[1].SiteCodeText);
        Assert.Equal("2 филиала", model.TotalText);
        Assert.False(model.HasBannerError);
        Assert.False(model.IsEmpty);
        // Контракт веб-страницы: getBranches('tmn') — город по умолчанию.
        var city = Assert.Single(api.NetworkBranchesCalls);
        Assert.Equal("tmn", city);
    }

    [Fact]
    public async Task SearchTextFiltersBranchesLocally()
    {
        var api = new FakeHubApiClient
        {
            NetworkBranches = new HubNetworkBranchList
            {
                Branches =
                [
                    new HubNetworkBranch { Id = 1, Name = "Первомайская", BranchCode = "tmn-p1" },
                    new HubNetworkBranch { Id = 2, Name = "Республики", BranchCode = "tmn-resp" },
                    new HubNetworkBranch { Id = 3, Name = "Газовиков", BranchCode = "tmn-gaz" },
                ],
            },
        };
        var model = new NetworksViewModel(api);
        await model.LoadAsync();

        model.SearchText = "респ";

        Assert.Single(model.Items);
        Assert.Equal("Республики", model.Items[0].Title);

        // Поиск и по коду филиала — как filteredBranches в вебе.
        model.SearchText = "GAZ";
        Assert.Single(model.Items);
        Assert.Equal(3, model.Items[0].Id);

        model.SearchText = string.Empty;
        Assert.Equal(3, model.Items.Count);
        // Локальный фильтр — повторных запросов на сервер нет.
        Assert.Equal(1, api.NetworkBranchesCallCount);
    }

    [Fact]
    public async Task EmptyListShowsEmptyState()
    {
        var api = new FakeHubApiClient
        {
            NetworkBranches = new HubNetworkBranchList { Branches = [] },
        };
        var model = new NetworksViewModel(api);

        await model.LoadAsync();

        Assert.Empty(model.Items);
        Assert.True(model.IsEmpty);
        Assert.Equal("0 филиалов", model.TotalText);
    }

    // ---- Карточка филиала ----

    [Fact]
    public async Task SelectingBranchLoadsDetailWithDevicesAndMaps()
    {
        var api = new FakeHubApiClient
        {
            NetworkBranches = new HubNetworkBranchList
            {
                Branches =
                [
                    new HubNetworkBranch { Id = 5, Name = "Первомайская", BranchCode = "tmn-p1" },
                ],
            },
            NetworkOverviewFactory = branchId => new HubNetworkOverview
            {
                Branch = new HubNetworkBranch
                {
                    Id = branchId,
                    CityCode = "tmn",
                    BranchCode = "tmn-p1",
                    Name = "Первомайская",
                    DefaultSiteCode = "P19",
                    DbId = "ITINVENT",
                },
                Metrics = new HubNetworkMetrics
                {
                    DevicesCount = 2,
                    PortsCount = 48,
                    OccupiedPorts = 20,
                    SocketsCount = 30,
                    MapsCount = 1,
                    MapPointsCount = 6,
                },
                Sites =
                [
                    new HubNetworkSite
                    {
                        Id = 11,
                        BranchId = branchId,
                        SiteCode = "P19",
                        Name = "Этаж 1",
                        DevicesCount = 2,
                        PortsCount = 48,
                    },
                ],
            },
            NetworkDevices = new HubNetworkDeviceList
            {
                Devices =
                [
                    new HubNetworkDevice
                    {
                        Id = 21,
                        BranchId = 5,
                        SiteName = "Этаж 1",
                        SiteCode = "P19",
                        DeviceCode = "ASW-P19-1",
                        DeviceType = "switch",
                        Vendor = "Cisco",
                        Model = "CBS350",
                        MgmtIp = "10.0.0.2",
                        PortsCount = 48,
                        OccupiedPorts = 20,
                        Notes = "серверная",
                    },
                    new HubNetworkDevice
                    {
                        Id = 22,
                        BranchId = 5,
                        DeviceCode = "AP-1",
                        DeviceType = "ap",
                        PortsCount = 0,
                    },
                ],
            },
            NetworkMaps = new HubNetworkMapList
            {
                Maps =
                [
                    new HubNetworkMap
                    {
                        Id = 31,
                        BranchId = 5,
                        Title = "Этаж 1",
                        FloorLabel = "1 этаж",
                        SiteName = "Этаж 1",
                        FileName = "floor1.png",
                        MimeType = "image/png",
                        FileSize = 2048,
                    },
                ],
            },
        };
        var model = new NetworksViewModel(api);
        await model.LoadAsync();

        model.SelectedBranch = model.Items[0];
        await WaitFor(() => model.Detail is { Maps.Count: > 0 } && !model.IsDetailLoading);

        var detail = model.Detail!;
        Assert.Equal("Первомайская", detail.Title);
        Assert.Equal("tmn-p1", detail.BranchCodeText);
        Assert.Equal("Город: Тюмень", detail.CityCodeText);
        Assert.Equal("Код сайта: P19", detail.SiteCodeText);
        Assert.Equal("База: ITINVENT", detail.DbIdText);
        Assert.Equal("Уст: 2", detail.DevicesChipText);
        Assert.Equal("Порты: 48", detail.PortsChipText);
        Assert.Equal("Занято: 20", detail.OccupiedChipText);
        Assert.Equal("Розетки: 30", detail.SocketsChipText);
        Assert.Equal("Карты: 1", detail.MapsChipText);
        Assert.Equal("Точки: 6", detail.PointsChipText);
        var site = Assert.Single(detail.Sites);
        Assert.Contains("P19", site);
        Assert.Contains("Этаж 1", site);
        Assert.Contains("устройств: 2", site);

        Assert.Equal(2, detail.Devices.Count);
        Assert.Equal("Оборудование · 2", detail.DevicesTitleText);
        var device = detail.Devices[0];
        Assert.Equal("ASW-P19-1", device.DeviceCodeText);
        Assert.Equal("Коммутатор", device.DeviceTypeText);
        Assert.Equal("Cisco CBS350", device.ModelText);
        Assert.Equal("Этаж 1 · P19", device.SiteText);
        Assert.Equal("10.0.0.2", device.MgmtIpText);
        Assert.Equal("20/48", device.PortsText);
        Assert.Equal("серверная", device.NotesText);
        Assert.Equal("Точка доступа", detail.Devices[1].DeviceTypeText);

        var map = Assert.Single(detail.Maps);
        Assert.Equal("Этаж 1", map.Title);
        Assert.Equal("floor1.png", map.FileName);
        Assert.Equal("1 этаж · Этаж 1", map.SubtitleText);
        Assert.Equal("Этаж 1 (2 КБ)", map.DisplayText);
        Assert.Equal("Схемы сети · 1", detail.MapsTitleText);
        Assert.False(model.HasDetailError);

        Assert.Equal([5L], api.NetworkOverviewCalls);
        Assert.Equal([5L], api.NetworkDevicesCalls);
        Assert.Equal([5L], api.NetworkMapsCalls);
    }

    [Fact]
    public async Task DetailLoadErrorShowsDetailErrorText()
    {
        var api = new FakeHubApiClient
        {
            NetworkBranches = new HubNetworkBranchList
            {
                Branches = [new HubNetworkBranch { Id = 5, Name = "Филиал" }],
            },
            NetworkOverviewException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new NetworksViewModel(api);
        await model.LoadAsync();

        model.SelectedBranch = model.Items[0];
        await WaitFor(() => model.HasDetailError && !model.IsDetailLoading);

        Assert.Equal("Нет соединения с сервером HUB. Проверьте сеть и повторите попытку.",
            model.DetailErrorText);
        Assert.Null(model.Detail);
    }

    [Fact]
    public async Task BranchesLoadErrorShowsBanner()
    {
        var api = new FakeHubApiClient
        {
            NetworkBranchesException = new HubApiException(
                HubApiErrorKind.Http, "forbidden", HttpStatusCode.Forbidden),
        };
        var model = new NetworksViewModel(api);

        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);

        Assert.Equal("Недостаточно прав для этого действия.", model.BannerErrorText);
        Assert.True(model.HasBannerError);

        model.DismissBannerCommand.Execute(null);
        Assert.False(model.HasBannerError);
    }

    [Fact]
    public async Task SwitchingBranchKeepsLatestDetail()
    {
        var api = new FakeHubApiClient
        {
            NetworkBranches = new HubNetworkBranchList
            {
                Branches =
                [
                    new HubNetworkBranch { Id = 1, Name = "Первый" },
                    new HubNetworkBranch { Id = 2, Name = "Второй" },
                ],
            },
            NetworkOverviewFactory = branchId => new HubNetworkOverview
            {
                Branch = new HubNetworkBranch { Id = branchId, Name = $"Филиал {branchId}" },
            },
        };
        var model = new NetworksViewModel(api);
        await model.LoadAsync();

        model.SelectedBranch = model.Items[0];
        model.SelectedBranch = model.Items[1];
        await WaitFor(() => model.Detail?.Title == "Филиал 2" && !model.IsDetailLoading);

        Assert.Equal("Филиал 2", model.Detail!.Title);
        Assert.Contains(1L, api.NetworkOverviewCalls);
        Assert.Contains(2L, api.NetworkOverviewCalls);
    }

    // ---- Файлы-схемы ----

    [Fact]
    public async Task MapFileChipDownloadsThroughSeam()
    {
        var api = new FakeHubApiClient
        {
            NetworkBranches = BranchesWith(5),
            NetworkMaps = MapsWith(31),
        };
        var model = new NetworksViewModel(api);
        await model.LoadAsync();
        model.SelectedBranch = model.Items[0];
        await WaitFor(() => model.Detail is { Maps.Count: > 0 });
        var saved = new List<(long MapId, bool ExportPdf)>();
        model.MapFileSaver = (item, exportPdf) =>
        {
            saved.Add((item.Id, exportPdf));
            return Task.CompletedTask;
        };

        var chip = model.Detail!.Maps[0];
        Assert.True(chip.IsDownloadEnabled);
        await ((NativeAsyncCommand)model.OpenMapFileCommand).ExecuteAsync(chip);

        Assert.Equal([(31L, false)], saved);
        Assert.False(chip.IsDownloading);
        // Шов подменил путь — реальное скачивание через API не дёргалось.
        Assert.Empty(api.NetworkMapFileDownloads);
    }

    [Fact]
    public async Task MapPdfButtonExportsThroughSeam()
    {
        var api = new FakeHubApiClient
        {
            NetworkBranches = BranchesWith(5),
            NetworkMaps = MapsWith(31),
        };
        var model = new NetworksViewModel(api);
        await model.LoadAsync();
        model.SelectedBranch = model.Items[0];
        await WaitFor(() => model.Detail is { Maps.Count: > 0 });
        var saved = new List<(long MapId, bool ExportPdf)>();
        model.MapFileSaver = (item, exportPdf) =>
        {
            saved.Add((item.Id, exportPdf));
            return Task.CompletedTask;
        };

        await ((NativeAsyncCommand)model.ExportMapPdfCommand).ExecuteAsync(model.Detail!.Maps[0]);

        Assert.Equal([(31L, true)], saved);
        Assert.Empty(api.NetworkMapPdfDownloads);
    }

    [Fact]
    public async Task MapDownloadErrorShowsBanner()
    {
        var api = new FakeHubApiClient
        {
            NetworkBranches = BranchesWith(5),
            NetworkMaps = MapsWith(31),
        };
        var model = new NetworksViewModel(api)
        {
            MapFileSaver = (_, _) => Task.FromException(
                new HubApiException(HubApiErrorKind.Transport, "down")),
        };
        await model.LoadAsync();
        model.SelectedBranch = model.Items[0];
        await WaitFor(() => model.Detail is { Maps.Count: > 0 });

        await ((NativeAsyncCommand)model.OpenMapFileCommand).ExecuteAsync(model.Detail!.Maps[0]);

        Assert.Equal("Нет соединения с сервером HUB. Проверьте сеть и повторите попытку.",
            model.BannerErrorText);
        Assert.False(model.Detail!.Maps[0].IsDownloading);
    }

    [Fact]
    public async Task MapCommandIgnoresForeignParameter()
    {
        var api = new FakeHubApiClient
        {
            NetworkBranches = BranchesWith(5),
            NetworkMaps = MapsWith(31),
        };
        var model = new NetworksViewModel(api);
        await model.LoadAsync();

        // CanExecute отсекает параметр не-чип — Execute безопасно ничего не делает.
        Assert.False(model.OpenMapFileCommand.CanExecute("не чип"));
        Assert.False(model.ExportMapPdfCommand.CanExecute(null));
        await ((NativeAsyncCommand)model.OpenMapFileCommand).ExecuteAsync(null);
        Assert.Empty(api.NetworkMapFileDownloads);
    }

    // ---- Сброс ----

    [Fact]
    public async Task ResetClearsState()
    {
        var api = new FakeHubApiClient
        {
            NetworkBranches = BranchesWith(5),
            NetworkMaps = MapsWith(31),
            NetworkDevices = new HubNetworkDeviceList
            {
                Devices = [new HubNetworkDevice { Id = 21, DeviceCode = "ASW" }],
            },
        };
        var model = new NetworksViewModel(api);
        await model.LoadAsync();
        model.SelectedBranch = model.Items[0];
        await WaitFor(() => model.Detail is { Maps.Count: > 0 });
        model.SearchText = "пер";

        model.Reset();

        Assert.Empty(model.Items);
        Assert.Null(model.Detail);
        Assert.Null(model.SelectedBranch);
        Assert.True(model.ShowDetailPlaceholder);
        Assert.Equal(string.Empty, model.SearchText);
        Assert.Equal(string.Empty, model.TotalText);
        Assert.Equal(string.Empty, model.LastUpdatedText);
        Assert.False(model.HasBannerError);
        Assert.False(model.HasDetailError);
        Assert.False(model.IsLoading);
        Assert.False(model.IsDetailLoading);
        Assert.True(model.IsEmpty);
    }

    private static HubNetworkBranchList BranchesWith(long id) => new()
    {
        Branches = [new HubNetworkBranch { Id = id, Name = "Филиал", BranchCode = "tmn-b" }],
    };

    private static HubNetworkMapList MapsWith(long mapId) => new()
    {
        Maps =
        [
            new HubNetworkMap
            {
                Id = mapId,
                Title = "Этаж 1",
                FileName = "floor1.png",
                MimeType = "image/png",
                FileSize = 100,
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
}
