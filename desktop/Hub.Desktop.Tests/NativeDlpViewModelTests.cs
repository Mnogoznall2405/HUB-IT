using System.Text.Json;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

/// <summary>
/// VM-тесты «🛡 DLP»: загрузка сводки/списка/«требует внимания», выбор хоста и
/// дня, вкладки проб, CRUD графиков филиалов и обработка ошибок. Admin-гейт
/// шелла — последние два теста (fail-closed, как /dlp adminOnly в вебе).
/// </summary>
public sealed class NativeDlpViewModelTests
{
    private static HubDlpHost Host(
        string name,
        string? branch = "Тюмень",
        string? fullName = "Иван Иванов",
        long lastTs = 0) =>
        new()
        {
            ComputerName = name,
            WindowsUser = name + "\\user",
            UserLogin = "DOM\\" + name.ToLowerInvariant(),
            UserFullName = fullName,
            BranchName = branch,
            FileEvents = 12,
            UsbEvents = 3,
            TelegramEvents = 4,
            MaxEvents = 1,
            Visits = 42,
            LastTs = lastTs,
        };

    private static HubDlpAttentionHost Attention(
        string name,
        double entertainment = 0,
        double away = 0,
        int usb = 0,
        int messenger = 0,
        double active = 3600) =>
        new()
        {
            ComputerName = name,
            UserFullName = "Иван Иванов",
            BranchName = "Тюмень",
            ActiveSec = active,
            AwaySec = away,
            EntertainmentSec = entertainment,
            UsbFiles = usb,
            UsbBytes = usb * 1024,
            MessengerFiles = messenger,
        };

    private static HubDlpActivityResponse Activity() =>
        new()
        {
            Success = true,
            Buckets =
            [
                new HubDlpActivityBucket
                {
                    BucketStart = "2026-03-02T09:00:00+05:00",
                    ActiveSec = 280,
                    Zone = "work",
                    App = "chrome.exe",
                },
                new HubDlpActivityBucket
                {
                    BucketStart = "2026-03-02T09:05:00+05:00",
                    AwaySec = 300,
                    Zone = "work",
                },
            ],
            Summary = new HubDlpActivitySummary
            {
                ActiveSec = 7200,
                PassiveSec = 300,
                AwaySec = 600,
                LockedSec = 100,
                BreakSec = 2700,
                OffshiftSec = 1800,
                ActiveOffshiftSec = 120,
                ActivityPct = 88.9,
            },
            AppsTop = [new HubDlpAppTop { App = "chrome.exe", Sec = 5000 }],
            LocalTime = new HubDlpLocalTime
            {
                Day = "2026-03-02",
                BranchName = "Тюмень",
                UtcOffsetMinutes = 300,
                WorkStartMin = 540,
                WorkEndMin = 1080,
                LunchStartMin = 780,
                LunchEndMin = 825,
                WorkdaysMask = 31,
            },
        };

    private static async Task<DlpViewModel> LoadedAsync(FakeHubApiClient api)
    {
        var vm = new DlpViewModel(api);
        await vm.LoadAsync(CancellationToken.None);
        return vm;
    }

    private static async Task<(DlpViewModel Vm, HubDlpActivityResponse? Activity)> LoadedWithHostAsync(
        FakeHubApiClient api)
    {
        var vm = await LoadedAsync(api);
        vm.SelectedHost = vm.Hosts[0];
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(5);
        while (!vm.HasDetail && DateTime.UtcNow < deadline)
        {
            await Task.Delay(20);
        }

        return (vm, api.DlpActivity);
    }

    // ---- Загрузка ----

    [Fact]
    public async Task LoadFillsHostsSummaryAttentionAndSchedules()
    {
        var api = new FakeHubApiClient
        {
            DlpHosts = new HubDlpHostsResponse
            {
                Success = true,
                Hosts = [Host("PC-01"), Host("PC-02", branch: "Магадан", fullName: null)],
            },
            DlpSummary = new HubDlpSummaryResponse
            {
                Summary = new HubDlpSummary
                {
                    HostsTotal = 38,
                    HostsActiveToday = 12,
                    VisitsToday = 431,
                    FileEventsToday = 56,
                },
            },
            DlpAttention = new HubDlpAttentionResponse
            {
                Hosts = [Attention("PC-01", entertainment: 900, usb: 2, messenger: 5)],
            },
            DlpWorkSchedules = new HubDlpWorkSchedulesResponse
            {
                Success = true,
                Branches = ["Магадан", "Тюмень"],
                Items =
                [
                    new HubDlpWorkSchedule
                    {
                        BranchName = "Тюмень",
                        WorkStartMin = 540,
                        WorkEndMin = 1080,
                        LunchStartMin = 780,
                        LunchEndMin = 825,
                        WorkdaysMask = 31,
                    },
                ],
            },
        };

        var vm = await LoadedAsync(api);

        Assert.Equal(2, vm.Hosts.Count);
        Assert.Equal("ПК: 2", vm.TotalText);
        Assert.Contains("38", vm.SummaryText);
        Assert.Contains("431", vm.SummaryText);
        Assert.True(vm.HasSummary);
        Assert.False(vm.IsLoading);
        Assert.False(vm.HasBannerError);

        // KPI из attention: активные ПК + метрики.
        Assert.Equal("1", vm.KpiActiveText);
        Assert.Equal(4, vm.AttentionGroups.Count);
        Assert.Equal("Развлечения", vm.AttentionGroups[0].Title);
        var row = Assert.Single(vm.AttentionGroups[0].Items);
        Assert.Equal("PC-01", row.ComputerName);

        // Графики: Тюмень с графиком, Магадан — по умолчанию.
        Assert.Equal(2, vm.Schedules.Count);
        var magadan = Assert.Single(vm.Schedules, s => s.BranchName == "Магадан");
        Assert.False(magadan.HasSchedule);
        Assert.Equal("09:00–18:00 (по умолчанию)", magadan.WorkText);
        var tyumen = Assert.Single(vm.Schedules, s => s.BranchName == "Тюмень");
        Assert.True(tyumen.HasSchedule);
        Assert.Equal("13:00–13:45", tyumen.LunchText);
        Assert.Equal("Пн Вт Ср Чт Пт", tyumen.DaysText);
    }

    [Fact]
    public async Task LoadErrorSetsBanner()
    {
        var api = new FakeHubApiClient
        {
            DlpException = new HttpRequestException("503"),
        };
        var vm = await LoadedAsync(api);

        Assert.True(vm.HasBannerError);
        Assert.Empty(vm.Hosts);
    }

    // ---- Список и выбор хоста ----

    [Fact]
    public async Task SearchAndBranchFilterSliceHostList()
    {
        var api = new FakeHubApiClient
        {
            DlpHosts = new HubDlpHostsResponse
            {
                Hosts = [Host("PC-01"), Host("PC-02", branch: "Магадан")],
            },
            DlpAttention = new HubDlpAttentionResponse(),
        };
        var vm = await LoadedAsync(api);

        vm.SelectedBranch = "Магадан";
        var item = Assert.Single(vm.Hosts);
        Assert.Equal("PC-02", item.ComputerName);

        vm.SelectedBranch = "Все филиалы";
        vm.SearchText = "pc-02";
        Assert.Single(vm.Hosts);
        vm.SearchText = "иван";
        Assert.Equal(2, vm.Hosts.Count);
    }

    [Fact]
    public async Task SelectHostLoadsActivityDetail()
    {
        var api = new FakeHubApiClient
        {
            DlpHosts = new HubDlpHostsResponse { Hosts = [Host("PC-01")] },
            DlpAttention = new HubDlpAttentionResponse(),
            DlpActivity = Activity(),
        };

        var (vm, _) = await LoadedWithHostAsync(api);

        Assert.True(vm.HasDetail);
        Assert.Equal("PC-01", vm.DetailTitle);
        Assert.Contains("UTC+5:00", vm.DetailSubtitle);
        Assert.Equal("Смена 09:00–18:00", vm.DetailShiftText);
        Assert.Equal("Обед 13:00–13:45", vm.DetailLunchText);
        Assert.Equal("2 ч 0 мин", vm.DetActiveText);
        Assert.Equal("45 мин", vm.DetBreakText);
        Assert.Contains("Активность 88", vm.DetPctText);
        Assert.Contains("Ввод вне смены", vm.DetActiveOffshiftText);

        // 288 ячеек, 2 непустые, серия «активен 09:00» + «отошёл 09:05».
        Assert.Equal(288, vm.Buckets.Count);
        Assert.Contains(vm.Runs, run => run.StateText == "активен");
        Assert.Contains(vm.Runs, run => run.StateText == "отошёл");
        var app = Assert.Single(vm.TopApps);
        Assert.Equal("chrome.exe", app.Name);

        var call = Assert.Single(api.DlpActivityCalls);
        Assert.Equal("PC-01", call.Computer);
    }

    [Fact]
    public async Task DayChangeReloadsActivityWithBranchLocalDay()
    {
        var api = new FakeHubApiClient
        {
            DlpHosts = new HubDlpHostsResponse { Hosts = [Host("PC-01")] },
            DlpAttention = new HubDlpAttentionResponse(),
            DlpActivity = Activity(),
        };
        var (vm, _) = await LoadedWithHostAsync(api);

        vm.DetailDate = new DateTime(2026, 3, 2);
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(5);
        while (api.DlpActivityCalls.Count < 2 && DateTime.UtcNow < deadline)
        {
            await Task.Delay(20);
        }

        Assert.Equal(2, api.DlpActivityCalls.Count);
        Assert.Equal("2026-03-02", api.DlpActivityCalls[1].Day);
    }

    // ---- Вкладки проб ----

    [Fact]
    public async Task FilesTabListsEgressRows()
    {
        var api = new FakeHubApiClient
        {
            DlpHosts = new HubDlpHostsResponse { Hosts = [Host("PC-01")] },
            DlpAttention = new HubDlpAttentionResponse(),
            DlpActivity = Activity(),
            FsEgress = new HubFsEgressResponse
            {
                Items =
                [
                    new HubFsEgressEvent
                    {
                        Ts = 1730000000,
                        Channel = "usb",
                        FileName = "отчёт.docx",
                        Size = 2048,
                        Count = 3,
                    },
                ],
                NoiseHidden = 5,
            },
        };

        var (vm, _) = await LoadedWithHostAsync(api);
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(5);
        while (vm.FileEvents.Count == 0 && DateTime.UtcNow < deadline)
        {
            await Task.Delay(20);
        }

        var row = Assert.Single(vm.FileEvents);
        Assert.Equal("USB", row.ChannelText);
        Assert.Equal("отчёт.docx", row.FileName);
        Assert.Equal("×3", row.CountText);
        Assert.Equal("Скрыто служебных: 5", vm.NoiseHiddenText);
    }

    [Fact]
    public async Task TelegramAndBrowserTabsLoadOnSwitch()
    {
        var api = new FakeHubApiClient
        {
            DlpHosts = new HubDlpHostsResponse { Hosts = [Host("PC-01")] },
            DlpAttention = new HubDlpAttentionResponse(),
            DlpActivity = Activity(),
            TelegramChats = new HubDlpChatsResponse
            {
                Chats =
                [
                    new HubDlpChat
                    {
                        ChatId = "-100",
                        ChatName = "Рабочий чат",
                        UpdatedAt = 1730000000,
                        Messages =
                        [
                            new HubDlpChatMessage
                            {
                                Direction = "in",
                                Time = "10:00",
                                Sender = "Босс",
                                Text = "Отчёт готов?",
                            },
                        ],
                    },
                ],
            },
            BrowserVisits = new HubBrowserVisitsResponse
            {
                Total = 1,
                Items =
                [
                    new HubBrowserVisit
                    {
                        Id = 1,
                        Browser = "chrome",
                        Profile = "work",
                        Url = "https://mail.ru",
                        Title = "Почта",
                        Domain = "mail.ru",
                        CategoryDisplay = "mail",
                        VisitedAt = "2026-03-02T10:00:00+03:00",
                        DwellSec = 120,
                    },
                ],
            },
        };
        var (vm, _) = await LoadedWithHostAsync(api);

        vm.IsTelegramTab = true;
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(5);
        while (vm.Chats.Count == 0 && DateTime.UtcNow < deadline)
        {
            await Task.Delay(20);
        }

        var chat = Assert.Single(vm.Chats);
        Assert.Equal("Рабочий чат", chat.ChatName);
        Assert.Contains("Босс", Assert.Single(chat.Messages).SenderText);

        vm.IsBrowserTab = true;
        deadline = DateTime.UtcNow + TimeSpan.FromSeconds(5);
        while (vm.BrowserVisits.Count == 0 && DateTime.UtcNow < deadline)
        {
            await Task.Delay(20);
        }

        var visit = Assert.Single(vm.BrowserVisits);
        Assert.Equal("Почта", visit.TitleText);
        Assert.Equal("Почта", visit.CategoryText);
        Assert.Equal("Визитов: 1", vm.BrowserTotalText);
    }

    // ---- «Требует внимания» → выбор хоста ----

    [Fact]
    public async Task AttentionRowSelectsHost()
    {
        var api = new FakeHubApiClient
        {
            DlpHosts = new HubDlpHostsResponse { Hosts = [Host("PC-01")] },
            DlpAttention = new HubDlpAttentionResponse
            {
                Hosts = [Attention("PC-01", entertainment: 900)],
            },
            DlpActivity = Activity(),
        };
        var vm = await LoadedAsync(api);

        vm.SelectHostCommand.Execute("PC-01");

        Assert.Equal("PC-01", vm.SelectedHost?.ComputerName);
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(5);
        while (!vm.HasDetail && DateTime.UtcNow < deadline)
        {
            await Task.Delay(20);
        }

        Assert.True(vm.HasDetail);
    }

    // ---- Графики работ ----

    [Fact]
    public async Task ScheduleEditSavePutsPayloadAndReloads()
    {
        var api = new FakeHubApiClient
        {
            DlpHosts = new HubDlpHostsResponse(),
            DlpAttention = new HubDlpAttentionResponse(),
            DlpWorkSchedules = new HubDlpWorkSchedulesResponse
            {
                Branches = ["Тюмень"],
                Items = [],
            },
        };
        var vm = await LoadedAsync(api);
        var item = Assert.Single(vm.Schedules);

        // «Задать график» для филиала без строки → черновик с дефолтами веба.
        vm.EditScheduleCommand.Execute(item);
        var draft = vm.EditingSchedule!;
        Assert.NotNull(draft);
        Assert.Equal("09:00", draft.WorkStartText);
        Assert.Equal("18:00", draft.WorkEndText);
        Assert.False(draft.LunchEnabled);
        draft.LunchEnabled = true;
        draft.LunchStartText = "13:00";
        draft.LunchEndText = "13:45";
        draft.Sun = true;

        await ((NativeAsyncCommand)vm.SaveScheduleCommand).ExecuteAsync(null, CancellationToken.None);

        var save = Assert.Single(api.DlpScheduleSaves);
        Assert.Equal("Тюмень", save.Branch);
        Assert.Equal(540, save.WorkStartMin);
        Assert.Equal(1080, save.WorkEndMin);
        Assert.Equal(780, save.LunchStartMin);
        Assert.Equal(825, save.LunchEndMin);
        Assert.Equal(0, save.TzOffsetMinutes);
        Assert.Equal(95, save.WorkdaysMask); // 31 | 64 (Вс)
        Assert.Null(vm.EditingSchedule);
        Assert.Contains("сохранён", vm.ScheduleNoticeText);
    }

    [Fact]
    public async Task ScheduleValidationBlocksInvalidPayload()
    {
        var api = new FakeHubApiClient
        {
            DlpHosts = new HubDlpHostsResponse(),
            DlpAttention = new HubDlpAttentionResponse(),
            DlpWorkSchedules = new HubDlpWorkSchedulesResponse { Branches = ["Тюмень"], Items = [] },
        };
        var vm = await LoadedAsync(api);
        vm.EditScheduleCommand.Execute(vm.Schedules[0]);
        var draft = vm.EditingSchedule!;
        draft.WorkEndText = "08:00"; // конец раньше начала

        await ((NativeAsyncCommand)vm.SaveScheduleCommand).ExecuteAsync(null, CancellationToken.None);

        Assert.Empty(api.DlpScheduleSaves);
        Assert.True(vm.HasScheduleNotice);
        Assert.True(vm.IsScheduleNoticeError);
        Assert.NotNull(vm.EditingSchedule); // черновик остаётся на правку
    }

    [Fact]
    public async Task ScheduleDeleteRequiresSecondArmedClick()
    {
        var api = new FakeHubApiClient
        {
            DlpHosts = new HubDlpHostsResponse(),
            DlpAttention = new HubDlpAttentionResponse(),
            DlpWorkSchedules = new HubDlpWorkSchedulesResponse
            {
                Branches = ["Тюмень"],
                Items =
                [
                    new HubDlpWorkSchedule
                    {
                        BranchName = "Тюмень",
                        WorkStartMin = 540,
                        WorkEndMin = 1080,
                    },
                ],
            },
        };
        var vm = await LoadedAsync(api);
        var item = Assert.Single(vm.Schedules);

        await ((NativeAsyncCommand)vm.DeleteScheduleCommand)
            .ExecuteAsync(item, CancellationToken.None);
        Assert.Empty(api.DlpScheduleDeletes); // первый клик только взводит
        Assert.Equal("Сбросить?", item.DeleteText);

        await ((NativeAsyncCommand)vm.DeleteScheduleCommand)
            .ExecuteAsync(item, CancellationToken.None);
        Assert.Equal(["Тюмень"], api.DlpScheduleDeletes);
        Assert.Contains("сброшен", vm.ScheduleNoticeText);
    }

    [Fact]
    public async Task DetailErrorShowsBannerInsteadOfCrash()
    {
        var api = new FakeHubApiClient
        {
            DlpHosts = new HubDlpHostsResponse { Hosts = [Host("PC-01")] },
            DlpAttention = new HubDlpAttentionResponse(),
            DlpActivityFactory = (_, _) => throw new HttpRequestException("500"),
        };
        var vm = await LoadedAsync(api);
        vm.SelectedHost = vm.Hosts[0];

        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(5);
        while (!vm.HasDetailError && DateTime.UtcNow < deadline)
        {
            await Task.Delay(20);
        }

        Assert.True(vm.HasDetailError);
        Assert.False(vm.HasDetail);
    }

    // ---- Admin-гейт шелла (fail-closed) ----

    [Collection("NativeTheme")]
    public sealed class ShellGate
    {
        private static readonly NativeSession Session = new(
            AccessToken: "access",
            RefreshToken: "refresh",
            ClientDeviceId: "desktop-test",
            AccessTokenExpiresAtUtc: DateTimeOffset.UtcNow.AddMinutes(15),
            UserId: 7,
            UserName: "ivanov",
            FullName: "Иван Иванов");

        [Fact]
        public async Task AdminRoleRevealsDlpAndNavigates()
        {
            var api = new FakeHubApiClient
            {
                StoredSession = Session,
                CurrentUser = new HubUser { Id = 7, Username = "ivanov", Role = "admin" },
            };
            var model = new HubShellViewModel(api);

            await model.InitializeAsync();

            Assert.True(model.IsDlpVisible);
            model.NavigateToPageCommand.Execute("dlp");
            Assert.True(model.IsDlpPage);
        }

        [Fact]
        public async Task NonAdminRoleKeepsDlpHiddenAndUnnavigable()
        {
            var api = new FakeHubApiClient
            {
                StoredSession = Session,
                CurrentUser = new HubUser { Id = 7, Username = "ivanov", Role = "user" },
            };
            var model = new HubShellViewModel(api);

            await model.InitializeAsync();

            Assert.False(model.IsDlpVisible);
            model.NavigateToPageCommand.Execute("dlp");
            Assert.False(model.IsDlpPage);
            Assert.True(model.IsDashboardPage); // fail-closed → дашборд
        }
    }
}
