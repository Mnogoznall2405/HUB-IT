using System.Net;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NativeMonitoringViewModelTests
{
    private static string Now() => DateTimeOffset.UtcNow.ToString("o");

    private static string Ago(TimeSpan offset) =>
        (DateTimeOffset.UtcNow - offset).ToString("o");

    // ---- Список устройств ----

    [Fact]
    public async Task LoadFillsTargetListWithStatuses()
    {
        var api = new FakeHubApiClient
        {
            MonitoringOverview = new HubMonitoringOverview
            {
                Targets =
                [
                    // Москва: online + свежие данные → «В сети».
                    new HubMonitoringTarget
                    {
                        Id = "t-msk",
                        Name = "MSK_MikroTik-RB5009",
                        Address = "10.0.1.1",
                        Port = 161,
                        Enabled = true,
                        Current = new HubMonitoringCurrent
                        {
                            Status = "online",
                            CheckedAt = Now(),
                            SnmpStatus = "ok",
                            LastSuccessAt = Now(),
                            IcmpCheckedAt = Now(),
                            OpenEvents = 0,
                            Ping = new HubMonitoringPing
                            {
                                Status = "online",
                                LatencyMs = 12,
                                LossPct = 0,
                            },
                            Device = new HubMonitoringDevice
                            {
                                SysName = "core-msk",
                                Description = "RouterOS RB5009",
                            },
                        },
                        Summary = new HubMonitoringSummary
                        {
                            Name = "ether1",
                            CheckedAt = Now(),
                            RxBps = 5_000_000,
                            TxBps = 2_000_000,
                        },
                    },
                    // Центральный узел: offline → «Нет связи», но в списке первый.
                    new HubMonitoringTarget
                    {
                        Id = "t-hub",
                        Name = "Центральный_MikroTik-CCR2116",
                        Address = "10.0.0.1",
                        Enabled = true,
                        Current = new HubMonitoringCurrent
                        {
                            Status = "offline",
                            CheckedAt = Now(),
                            SnmpStatus = "error",
                            OpenEvents = 2,
                        },
                        Outages =
                        [
                            new HubMonitoringOutage
                            {
                                Kind = "unreachable",
                                OpenedAt = Ago(TimeSpan.FromMinutes(30)),
                            },
                        ],
                    },
                    // Приостановленная цель — enabled=false.
                    new HubMonitoringTarget
                    {
                        Id = "t-tiksi",
                        Name = "Tiksi_MikroTik-hAP",
                        Address = "10.0.2.1",
                        Enabled = false,
                    },
                ],
                Worker = new HubMonitoringWorker
                {
                    Enabled = true,
                    HeartbeatAt = Now(),
                    CycleSeconds = 12,
                },
            },
        };
        var model = new MonitoringViewModel(api);

        await model.LoadAsync();

        Assert.Equal(3, model.Items.Count);
        // Сортировка веба: «Центральный узел» первым, затем Москва, остальные по имени.
        Assert.Equal("t-hub", model.Items[0].Id);
        Assert.Equal("Центральный узел", model.Items[0].Title);
        Assert.Equal("t-msk", model.Items[1].Id);
        Assert.Equal("Москва", model.Items[1].Title);
        Assert.Equal("t-tiksi", model.Items[2].Id);
        Assert.Equal("Тикси", model.Items[2].Title);

        var offline = model.Items[0];
        Assert.Equal("Нет связи", offline.StatusText);
        Assert.Equal("error", offline.StatusTone);
        Assert.Equal("offline", offline.StatusKey);

        var online = model.Items[1];
        Assert.Equal("В сети", online.StatusText);
        Assert.Equal("success", online.StatusTone);
        Assert.Equal("Задержка: 12 мс", online.LatencyText);
        Assert.True(online.HasLatency);
        Assert.Equal("↓ 5 Мбит/с · ↑ 2 Мбит/с · ether1", online.SummaryText);
        Assert.Equal("RB5009", online.ModelText);

        var paused = model.Items[2];
        Assert.Equal("Приостановлен", paused.StatusText);
        Assert.Equal("muted", paused.StatusTone);

        Assert.Equal("3 устройства", model.TotalText);
        Assert.Equal("требуют внимания: 1", model.IssuesText);
        Assert.False(model.HasBannerError);
        Assert.False(model.HasWorkerNotice);
        Assert.False(model.IsEmpty);
        Assert.Equal(1, api.MonitoringOverviewCallCount);
    }

    [Fact]
    public async Task SearchAndIssuesFilterWorkLocally()
    {
        var api = new FakeHubApiClient
        {
            MonitoringOverview = new HubMonitoringOverview
            {
                Targets =
                [
                    new HubMonitoringTarget
                    {
                        Id = "t-1",
                        Name = "MSK_MikroTik-RB",
                        Address = "10.0.1.1",
                        Enabled = true,
                        Current = new HubMonitoringCurrent
                        {
                            Status = "online",
                            CheckedAt = Now(),
                            SnmpStatus = "ok",
                            Device = new HubMonitoringDevice { SysName = "core-msk" },
                        },
                    },
                    new HubMonitoringTarget
                    {
                        Id = "t-2",
                        Name = "Tiksi_MikroTik-hAP",
                        Address = "10.0.2.1",
                        Enabled = true,
                        Current = new HubMonitoringCurrent
                        {
                            Status = "offline",
                            CheckedAt = Now(),
                        },
                    },
                ],
            },
        };
        var model = new MonitoringViewModel(api);
        await model.LoadAsync();

        // Клиентский поиск: по имени площадки и по sysName — как filteredTargets в вебе.
        model.SearchText = "тикси";
        Assert.Single(model.Items);
        Assert.Equal("t-2", model.Items[0].Id);

        model.SearchText = "core-msk";
        Assert.Single(model.Items);
        Assert.Equal("t-1", model.Items[0].Id);

        model.SearchText = "10.0.2";
        Assert.Single(model.Items);
        Assert.Equal("t-2", model.Items[0].Id);

        // «Требуют внимания» скрывает «В сети» и «Приостановлен».
        model.SearchText = string.Empty;
        model.IssuesOnly = true;
        var issue = Assert.Single(model.Items);
        Assert.Equal("t-2", issue.Id);

        model.IssuesOnly = false;
        Assert.Equal(2, model.Items.Count);
        // Локальный фильтр — повторных запросов нет.
        Assert.Equal(1, api.MonitoringOverviewCallCount);
    }

    [Fact]
    public async Task EmptyOverviewShowsEmptyState()
    {
        var api = new FakeHubApiClient
        {
            MonitoringOverview = new HubMonitoringOverview { Targets = [] },
        };
        var model = new MonitoringViewModel(api);

        await model.LoadAsync();

        Assert.Empty(model.Items);
        Assert.True(model.IsEmpty);
        Assert.Equal("0 устройств", model.TotalText);
        Assert.Equal(string.Empty, model.IssuesText);
    }

    // ---- Карточка устройства ----

    [Fact]
    public async Task SelectingTargetLoadsDetailWithMetricsInterfacesAndEvents()
    {
        var api = new FakeHubApiClient
        {
            MonitoringOverview = new HubMonitoringOverview
            {
                Targets =
                [
                    new HubMonitoringTarget
                    {
                        Id = "t-1",
                        Name = "MSK_MikroTik-CCR2004",
                        Address = "10.0.1.1",
                        Enabled = true,
                    },
                ],
            },
            MonitoringTargetDetailFactory = targetId => new HubMonitoringTarget
            {
                Id = targetId,
                Name = "MSK_MikroTik-CCR2004",
                Address = "10.0.1.1",
                Port = 161,
                Enabled = true,
                Current = new HubMonitoringCurrent
                {
                    Status = "online",
                    CheckedAt = Now(),
                    IcmpCheckedAt = Now(),
                    SnmpCheckedAt = Now(),
                    SnmpStatus = "ok",
                    LastSuccessAt = Now(),
                    OpenEvents = 1,
                    Ping = new HubMonitoringPing
                    {
                        Status = "online",
                        LatencyMs = 12,
                        LossPct = 0,
                    },
                    Device = new HubMonitoringDevice
                    {
                        SysName = "core-msk",
                        Description = "RouterOS CCR2004-1G-12S+2XS",
                        Serial = "HEX-123",
                        CpuPct = 42,
                        MemoryPct = 66,
                        StoragePct = 30,
                        TemperatureC = 55,
                        UptimeTicks = 360_000, // 1 час: 100 тиков = 1 с.
                        ResourcesAt = Now(),
                    },
                },
                Interfaces =
                [
                    new HubMonitoringInterface
                    {
                        Id = "i-1",
                        Name = "ether1",
                        Settings = new HubMonitoringInterfaceSettings
                        {
                            Role = "wan",
                            Critical = true,
                            Pinned = true,
                        },
                        Current = new HubMonitoringInterfaceCurrent
                        {
                            CheckedAt = Now(),
                            Admin = 1,
                            Oper = 1,
                            SpeedBps = 1_000_000_000,
                            RxBps = 5_000_000,
                            TxBps = 2_000_000,
                            RxUtilPct = 1,
                            TxUtilPct = 0,
                            Alias = "uplink",
                        },
                    },
                    new HubMonitoringInterface
                    {
                        Id = "i-2",
                        Name = "ether2",
                        Settings = new HubMonitoringInterfaceSettings { Critical = true },
                        Current = new HubMonitoringInterfaceCurrent
                        {
                            CheckedAt = Now(),
                            Admin = 1,
                            Oper = 2,
                        },
                    },
                ],
                Events =
                [
                    new HubMonitoringEvent
                    {
                        Id = "e-1",
                        Kind = "link",
                        Title = "Нет линка ether2",
                        Severity = "critical",
                        OpenedAt = Ago(TimeSpan.FromMinutes(15)),
                    },
                    new HubMonitoringEvent
                    {
                        Id = "e-2",
                        Kind = "cpu_pct",
                        Title = "CPU выше порога",
                        Severity = "warning",
                        OpenedAt = Ago(TimeSpan.FromHours(2)),
                        ClosedAt = Ago(TimeSpan.FromHours(1)),
                    },
                ],
            },
        };
        var model = new MonitoringViewModel(api);
        await model.LoadAsync();

        model.SelectedTarget = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        var detail = model.Detail!;
        Assert.Equal("Москва", detail.Title);
        Assert.Equal("10.0.1.1:161", detail.AddressText);
        Assert.Equal("RouterOS CCR2004-1G-12S+2XS", detail.SubtitleText);
        // open_events>0 → статус «Есть события».
        Assert.Equal("Есть события", detail.StatusText);
        Assert.Equal("warning", detail.StatusTone);
        Assert.Equal("ICMP: отвечает · 12 мс", detail.IcmpText);
        Assert.Equal("success", detail.IcmpTone);
        Assert.Equal("SNMP: отвечает", detail.SnmpText);
        Assert.Contains("Последний успех SNMP", detail.LastSuccessText);

        // Метрики: текст + значение для прогресса.
        Assert.Equal("42 %", detail.CpuText);
        Assert.Equal(42, detail.CpuValue);
        Assert.True(detail.HasCpu);
        Assert.Equal("66 %", detail.MemoryText);
        Assert.Equal("30 %", detail.StorageText);
        Assert.Equal("55 °C", detail.TemperatureText);
        Assert.Equal("12 мс", detail.LatencyText);
        Assert.Equal("0 %", detail.LossText);
        Assert.Equal("S/N: HEX-123", detail.SerialText);
        Assert.Equal("Аптайм: 1 ч 0 мин", detail.UptimeText);

        // Интерфейсы: состояние, скорость, трафик, контроль.
        Assert.Equal(2, detail.Interfaces.Count);
        Assert.Equal("Интерфейсы · 2", detail.InterfacesTitleText);
        var wan = detail.Interfaces[0];
        Assert.Equal("ether1", wan.Name);
        Assert.Equal("uplink", wan.AliasText);
        Assert.Equal("Up", wan.StatusText);
        Assert.Equal("success", wan.StatusTone);
        Assert.Equal("1 Гбит/с", wan.SpeedText);
        Assert.Equal("5 Мбит/с", wan.RxText);
        Assert.Equal("2 Мбит/с", wan.TxText);
        Assert.Equal("WAN", wan.ControlText);
        Assert.True(wan.IsPinned);
        var down = detail.Interfaces[1];
        Assert.Equal("Нет линка", down.StatusText);
        Assert.Equal("error", down.StatusTone); // critical → красный.

        // События: открытое критическое + завершённое с длительностью.
        Assert.Equal(2, detail.Events.Count);
        Assert.Equal("События · 2", detail.EventsTitleText);
        var open = detail.Events[0];
        Assert.True(open.IsOpen);
        Assert.Equal("Нет линка ether2", open.Title);
        Assert.Equal("error", open.StateTone);
        Assert.StartsWith("Открыто", open.StateText);
        var closed = detail.Events[1];
        Assert.False(closed.IsOpen);
        Assert.Equal("Завершено · 1 ч 0 мин", closed.StateText);
        Assert.Equal("muted", closed.StateTone);

        Assert.Equal(["t-1"], api.MonitoringTargetDetailCalls);
        Assert.False(model.HasDetailError);
    }

    [Fact]
    public async Task DetailLoadErrorShowsDetailErrorText()
    {
        var api = new FakeHubApiClient
        {
            MonitoringOverview = new HubMonitoringOverview
            {
                Targets =
                [
                    new HubMonitoringTarget { Id = "t-1", Name = "MSK", Enabled = true },
                ],
            },
            MonitoringTargetDetailException = new HubApiException(
                HubApiErrorKind.Transport, "down"),
        };
        var model = new MonitoringViewModel(api);
        await model.LoadAsync();

        model.SelectedTarget = model.Items[0];
        await WaitFor(() => model.HasDetailError && !model.IsDetailLoading);

        Assert.Equal("Нет соединения с сервером HUB. Проверьте сеть и повторите попытку.",
            model.DetailErrorText);
        Assert.Null(model.Detail);
    }

    [Fact]
    public async Task OverviewLoadErrorShowsBanner()
    {
        var api = new FakeHubApiClient
        {
            MonitoringOverviewException = new HubApiException(
                HubApiErrorKind.Http, "forbidden", HttpStatusCode.Forbidden),
        };
        var model = new MonitoringViewModel(api);

        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);

        Assert.Equal("Недостаточно прав для этого действия.", model.BannerErrorText);
        Assert.True(model.HasBannerError);

        model.DismissBannerCommand.Execute(null);
        Assert.False(model.HasBannerError);
    }

    // ---- Сборщик ----

    [Fact]
    public async Task WorkerDisabledShowsInfoNotice()
    {
        var api = new FakeHubApiClient
        {
            MonitoringOverview = new HubMonitoringOverview
            {
                Targets = [],
                Worker = new HubMonitoringWorker { Enabled = false },
            },
        };
        var model = new MonitoringViewModel(api);

        await model.LoadAsync();

        Assert.True(model.HasWorkerNotice);
        Assert.Equal("info", model.WorkerNoticeTone);
        Assert.Contains("не включён", model.WorkerNoticeText);
    }

    [Fact]
    public async Task WorkerStaleHeartbeatShowsWarningNotice()
    {
        var api = new FakeHubApiClient
        {
            MonitoringOverview = new HubMonitoringOverview
            {
                Targets = [],
                Worker = new HubMonitoringWorker
                {
                    Enabled = true,
                    HeartbeatAt = Ago(TimeSpan.FromMinutes(5)),
                },
            },
        };
        var model = new MonitoringViewModel(api);

        await model.LoadAsync();

        Assert.True(model.HasWorkerNotice);
        Assert.Equal("warning", model.WorkerNoticeTone);
        Assert.Contains("задерживается", model.WorkerNoticeText);
    }

    // ---- Статусная логика ----

    [Fact]
    public async Task StaleAndSnmpAndLinkStatusesMatchWeb()
    {
        var api = new FakeHubApiClient
        {
            MonitoringOverview = new HubMonitoringOverview
            {
                Targets =
                [
                    // Данные старше 2 минут → «Данные устарели».
                    new HubMonitoringTarget
                    {
                        Id = "t-stale",
                        Name = "Vologda",
                        Enabled = true,
                        Current = new HubMonitoringCurrent
                        {
                            Status = "online",
                            CheckedAt = Ago(TimeSpan.FromMinutes(10)),
                            SnmpStatus = "ok",
                        },
                    },
                    // Свежий опрос, но SNMP в ошибке → «Нет SNMP».
                    new HubMonitoringTarget
                    {
                        Id = "t-snmp",
                        Name = "Vladivostok",
                        Enabled = true,
                        Current = new HubMonitoringCurrent
                        {
                            Status = "online",
                            CheckedAt = Now(),
                            SnmpStatus = "error",
                        },
                    },
                    // Открытый эпизод link+wan → «Упал WAN».
                    new HubMonitoringTarget
                    {
                        Id = "t-wan",
                        Name = "Magadan",
                        Enabled = true,
                        Current = new HubMonitoringCurrent
                        {
                            Status = "online",
                            CheckedAt = Now(),
                            SnmpStatus = "ok",
                        },
                        Outages =
                        [
                            new HubMonitoringOutage
                            {
                                Kind = "link",
                                InterfaceRole = "wan",
                                InterfaceName = "ether1",
                                OpenedAt = Ago(TimeSpan.FromMinutes(5)),
                            },
                        ],
                    },
                    // Без проверок → «Ожидает опроса».
                    new HubMonitoringTarget
                    {
                        Id = "t-new",
                        Name = "Iturup",
                        Enabled = true,
                    },
                ],
            },
        };
        var model = new MonitoringViewModel(api);

        await model.LoadAsync();

        var byId = model.Items.ToDictionary(item => item.Id);
        Assert.Equal("Данные устарели", byId["t-stale"].StatusText);
        Assert.Equal("warning", byId["t-stale"].StatusTone);
        Assert.Equal("Нет SNMP", byId["t-snmp"].StatusText);
        Assert.Equal("warning", byId["t-snmp"].StatusTone);
        Assert.Equal("Упал WAN", byId["t-wan"].StatusText);
        Assert.Equal("error", byId["t-wan"].StatusTone);
        Assert.Equal("Ожидает опроса", byId["t-new"].StatusText);
        Assert.Equal("muted", byId["t-new"].StatusTone);
        Assert.Equal("требуют внимания: 4", model.IssuesText);
    }

    // ---- Сброс ----

    [Fact]
    public async Task ResetClearsState()
    {
        var api = new FakeHubApiClient
        {
            MonitoringOverview = new HubMonitoringOverview
            {
                Targets =
                [
                    new HubMonitoringTarget { Id = "t-1", Name = "MSK", Enabled = true },
                ],
            },
            MonitoringTargetDetail = new HubMonitoringTarget { Id = "t-1", Enabled = true },
        };
        var model = new MonitoringViewModel(api);
        await model.LoadAsync();
        model.SelectedTarget = model.Items[0];
        await WaitFor(() => model.Detail is not null);
        model.SearchText = "msk";
        model.IssuesOnly = true;

        model.Reset();

        Assert.Empty(model.Items);
        Assert.Null(model.Detail);
        Assert.Null(model.SelectedTarget);
        Assert.True(model.ShowDetailPlaceholder);
        Assert.Equal(string.Empty, model.SearchText);
        Assert.False(model.IssuesOnly);
        Assert.Equal(string.Empty, model.TotalText);
        Assert.Equal(string.Empty, model.IssuesText);
        Assert.Equal(string.Empty, model.LastUpdatedText);
        Assert.False(model.HasBannerError);
        Assert.False(model.HasDetailError);
        Assert.False(model.HasWorkerNotice);
        Assert.False(model.IsLoading);
        Assert.False(model.IsDetailLoading);
        Assert.True(model.IsEmpty);
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
