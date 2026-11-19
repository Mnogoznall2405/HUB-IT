using System.Net;
using System.Windows;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

// InitializeAsync грузит Settings и через него трогает статический NativeThemeManager —
// последовательно с тестами темы, чтобы параллельный Apply не ломал их проверки.
[Collection("NativeTheme")]
public sealed class NativeHubShellViewModelTests
{
    private static readonly NativeSession Session = new(
        AccessToken: "access",
        RefreshToken: "refresh",
        ClientDeviceId: "desktop-test",
        AccessTokenExpiresAtUtc: DateTimeOffset.UtcNow.AddMinutes(15),
        UserId: 7,
        UserName: "ivanov",
        FullName: "Иван Иванов");

    // ---- Шелл: сессия и вход ----

    [Fact]
    public async Task InitializeWithoutSessionShowsLogin()
    {
        var api = new FakeHubApiClient { StoredSession = null };
        var model = new HubShellViewModel(api);

        await model.InitializeAsync();

        Assert.Equal(HubShellState.SignedOut, model.State);
        Assert.False(model.RequiresTwoFactor);
    }

    [Fact]
    public async Task InitializeWithSessionLoadsDashboardAndTasks()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            TasksPage = PageOf(MakeTask(1, "Починить принтер", "new")),
            Dashboard = Dashboard(summary: new HubDashboardSummary { TasksOpenTotal = 3 }),
        };
        var model = new HubShellViewModel(api);

        await model.InitializeAsync();

        Assert.Equal(HubShellState.Ready, model.State);
        Assert.Equal("Иван Иванов", model.UserDisplayName);
        Assert.True(model.IsDashboardPage);
        var item = Assert.Single(model.Tasks.Items);
        Assert.Equal("Починить принтер", item.Title);
        Assert.Equal(5, model.Dashboard.StatCards.Count);
        Assert.Equal("3", model.Dashboard.StatCards[2].ValueText);
    }

    [Fact]
    public async Task SignInTransitionsToReadyAndClearsPasswordState()
    {
        var api = new FakeHubApiClient
        {
            LoginResult = new HubLoginResult(
                HubLoginStatus.Authenticated,
                Session,
                null,
                []),
            TasksPage = PageOf(),
        };
        var model = new HubShellViewModel(api) { LoginUsername = "ivanov" };

        await model.SignInAsync("secret");

        Assert.Equal(HubShellState.Ready, model.State);
        Assert.False(model.RequiresTwoFactor);
        Assert.Null(model.LoginErrorText);
        Assert.Equal("ivanov", api.LastLoginUsername);
    }

    [Fact]
    public async Task SignInWithTwoFactorChallengeWaitsForCode()
    {
        var api = new FakeHubApiClient
        {
            LoginResult = new HubLoginResult(
                HubLoginStatus.TwoFactorRequired,
                null,
                "challenge-1",
                ["totp"]),
        };
        var model = new HubShellViewModel(api) { LoginUsername = "ivanov" };

        await model.SignInAsync("secret");

        Assert.True(model.RequiresTwoFactor);
        Assert.Equal(HubShellState.SignedOut, model.State);
        Assert.False(model.CanSignIn);
    }

    [Fact]
    public async Task VerifyTwoFactorCompletesLogin()
    {
        var api = new FakeHubApiClient
        {
            LoginResult = new HubLoginResult(
                HubLoginStatus.TwoFactorRequired,
                null,
                "challenge-1",
                ["totp"]),
            TwoFactorResult = new HubLoginResult(
                HubLoginStatus.Authenticated,
                Session,
                null,
                []),
            TasksPage = PageOf(MakeTask(5, "Задание", "in_progress")),
        };
        var model = new HubShellViewModel(api) { LoginUsername = "ivanov" };
        await model.SignInAsync("secret");
        model.TwoFactorCode = "123456";

        await model.VerifyTwoFactorAsync();

        Assert.Equal(HubShellState.Ready, model.State);
        Assert.Equal("challenge-1", api.LastChallengeId);
        Assert.Equal("123456", api.LastTotpCode);
        Assert.Single(model.Tasks.Items);
    }

    [Fact]
    public async Task SignInErrorIsSurfacedInLoginError()
    {
        var api = new FakeHubApiClient
        {
            LoginException = new HubApiException(
                HubApiErrorKind.Http,
                "unauthorized",
                HttpStatusCode.Unauthorized),
        };
        var model = new HubShellViewModel(api) { LoginUsername = "ivanov" };

        // Команда маршаллит исключение в LoginErrorText, не пробрасывая его наружу.
        await ((NativeAsyncCommand)model.SignInCommand).ExecuteAsync("bad");

        Assert.Equal("Неверный логин или пароль.", model.LoginErrorText);
        Assert.Equal(HubShellState.SignedOut, model.State);
    }

    [Fact]
    public async Task SessionEndedEventReturnsToLogin()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            TasksPage = PageOf(MakeTask(1, "A", "new")),
        };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.Equal(HubShellState.Ready, model.State);

        api.RaiseSessionEnded();
        // RunOnUi без SynchronizationContext (тест) выполняет действие inline.
        Assert.Equal(HubShellState.SignedOut, model.State);
        Assert.Empty(model.Tasks.Items);
    }

    [Fact]
    public async Task LogoutClearsPagesAndShowsLogin()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            TasksPage = PageOf(MakeTask(1, "A", "new")),
            Dashboard = Dashboard(summary: new HubDashboardSummary { TasksOpenTotal = 2 }),
        };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.Equal(5, model.Dashboard.StatCards.Count);

        await ((NativeAsyncCommand)model.LogoutCommand).ExecuteAsync(null);

        Assert.Equal(HubShellState.SignedOut, model.State);
        Assert.Empty(model.Tasks.Items);
        Assert.Empty(model.Tickets.Items);
        Assert.Empty(model.Dashboard.StatCards);
    }

    [Fact]
    public async Task NavigateToPageCommandSwitchesCurrentPage()
    {
        var api = new FakeHubApiClient { StoredSession = Session, TasksPage = PageOf() };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.True(model.IsDashboardPage);

        model.NavigateToPageCommand.Execute("tasks");

        Assert.True(model.IsTasksPage);
        Assert.False(model.IsDashboardPage);
    }

    [Fact]
    public async Task NavigateToPageCommandSwitchesToTicketsPage()
    {
        var api = new FakeHubApiClient { StoredSession = Session };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.True(model.IsDashboardPage);

        model.NavigateToPageCommand.Execute("tickets");

        Assert.True(model.IsTicketsPage);
        Assert.Same(model.Tickets, model.CurrentPage);
        Assert.False(model.IsDashboardPage);
    }

    [Fact]
    public async Task NavigateToPageCommandSwitchesToMyFilesPage()
    {
        var api = new FakeHubApiClient { StoredSession = Session };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.True(model.IsDashboardPage);

        model.NavigateToPageCommand.Execute("myfiles");

        Assert.True(model.IsMyFilesPage);
        Assert.Same(model.MyFiles, model.CurrentPage);
        Assert.False(model.IsDashboardPage);
    }

    [Fact]
    public async Task LogoutResetsMyFilesPage()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            MyFilesPage = new HubMyFileListPage
            {
                Items = [new HubMyFileItem
                {
                    Id = "f1",
                    OriginalFileName = "a.txt",
                    Status = "ready",
                }],
            },
        };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.NotEmpty(model.MyFiles.Items);

        await ((NativeAsyncCommand)model.LogoutCommand).ExecuteAsync(null);

        Assert.Empty(model.MyFiles.Items);
        Assert.Equal(HubShellState.SignedOut, model.State);
    }

    [Fact]
    public async Task NavigateToPageCommandSwitchesToAddressBookPage()
    {
        var api = new FakeHubApiClient { StoredSession = Session };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.True(model.IsDashboardPage);

        model.NavigateToPageCommand.Execute("addressbook");

        Assert.True(model.IsAddressBookPage);
        Assert.Same(model.AddressBook, model.CurrentPage);
        Assert.False(model.IsDashboardPage);
    }

    [Fact]
    public async Task NavigateToPageCommandSwitchesToCompanyStructurePage()
    {
        var api = new FakeHubApiClient { StoredSession = Session };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.True(model.IsDashboardPage);

        model.NavigateToPageCommand.Execute("structure");

        Assert.True(model.IsCompanyStructurePage);
        Assert.Same(model.CompanyStructure, model.CurrentPage);
        Assert.False(model.IsDashboardPage);
    }

    [Fact]
    public async Task LogoutResetsCompanyStructurePage()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            CompanyStructureTree = new HubCompanyStructureTree
            {
                Items =
                [
                    new HubCompanyStructureNode { Id = "root", NodeType = "root", Title = "Компания" },
                ],
            },
        };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.NotEmpty(model.CompanyStructure.RootNodes);

        await ((NativeAsyncCommand)model.LogoutCommand).ExecuteAsync(null);

        Assert.Empty(model.CompanyStructure.RootNodes);
        Assert.Null(model.CompanyStructure.SelectedNode);
        Assert.Equal(HubShellState.SignedOut, model.State);
    }

    // ---- ИТ-объекты ----

    [Fact]
    public async Task NavigateToPageCommandSwitchesToItObjectsPage()
    {
        var api = new FakeHubApiClient { StoredSession = Session };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.True(model.IsDashboardPage);

        model.NavigateToPageCommand.Execute("itobjects");

        Assert.True(model.IsItObjectsPage);
        Assert.Same(model.ItObjects, model.CurrentPage);
        Assert.False(model.IsDashboardPage);
    }

    [Fact]
    public async Task LogoutResetsItObjectsPage()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            ItObjectsList = new HubItObjectList
            {
                Items =
                [
                    new HubItObject { ObjectRef = "ITINVENT:5", Name = "Площадка 1" },
                ],
            },
        };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.NotEmpty(model.ItObjects.Items);

        await ((NativeAsyncCommand)model.LogoutCommand).ExecuteAsync(null);

        Assert.Empty(model.ItObjects.Items);
        Assert.Null(model.ItObjects.Detail);
        Assert.Equal(HubShellState.SignedOut, model.State);
    }

    // ---- Сети ----

    [Fact]
    public async Task NavigateToPageCommandSwitchesToNetworksPage()
    {
        var api = new FakeHubApiClient { StoredSession = Session };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.True(model.IsDashboardPage);

        model.NavigateToPageCommand.Execute("networks");

        Assert.True(model.IsNetworksPage);
        Assert.Same(model.Networks, model.CurrentPage);
        Assert.False(model.IsDashboardPage);
    }

    [Fact]
    public async Task InitializeLoadsNetworkBranches()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            NetworkBranches = new HubNetworkBranchList
            {
                Branches = [new HubNetworkBranch { Id = 5, Name = "Первомайская" }],
            },
        };
        var model = new HubShellViewModel(api);

        await model.InitializeAsync();

        var item = Assert.Single(model.Networks.Items);
        Assert.Equal("Первомайская", item.Title);
        Assert.Equal("tmn", Assert.Single(api.NetworkBranchesCalls));
    }

    [Fact]
    public async Task LogoutResetsNetworksPage()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            NetworkBranches = new HubNetworkBranchList
            {
                Branches = [new HubNetworkBranch { Id = 5, Name = "Первомайская" }],
            },
        };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.NotEmpty(model.Networks.Items);

        await ((NativeAsyncCommand)model.LogoutCommand).ExecuteAsync(null);

        Assert.Empty(model.Networks.Items);
        Assert.Null(model.Networks.Detail);
        Assert.Null(model.Networks.SelectedBranch);
        Assert.Equal(HubShellState.SignedOut, model.State);
    }

    // ---- Компьютеры ----

    [Fact]
    public async Task NavigateToPageCommandSwitchesToComputersPage()
    {
        var api = new FakeHubApiClient { StoredSession = Session };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.True(model.IsDashboardPage);

        model.NavigateToPageCommand.Execute("computers");

        Assert.True(model.IsComputersPage);
        Assert.Same(model.Computers, model.CurrentPage);
        Assert.False(model.IsDashboardPage);
    }

    [Fact]
    public async Task InitializeLoadsComputersPage()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            ComputersPage = new HubComputersPage
            {
                Total = 1,
                Items =
                [
                    new HubComputer
                    {
                        MacAddress = "AA:BB:CC:00:00:01",
                        Hostname = "WS-01",
                        Status = "online",
                    },
                ],
            },
        };
        var model = new HubShellViewModel(api);

        await model.InitializeAsync();

        var item = Assert.Single(model.Computers.Items);
        Assert.Equal("WS-01", item.Title);
        Assert.NotEmpty(api.ComputersQueries);
    }

    [Fact]
    public async Task ComputersLoadErrorGoesToPageBannerNotShell()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            ComputersException = new HttpRequestException("boom"),
        };
        var model = new HubShellViewModel(api);

        await model.InitializeAsync();

        // Ошибка страницы — в её баннере, шелл остаётся готовым.
        Assert.Equal(HubShellState.Ready, model.State);
        Assert.True(model.Computers.HasBannerError);
        Assert.False(model.Computers.IsLoading);
    }

    [Fact]
    public async Task LogoutResetsComputersPage()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            ComputersPage = new HubComputersPage
            {
                Total = 1,
                Items =
                [
                    new HubComputer
                    {
                        MacAddress = "AA:BB:CC:00:00:01",
                        Hostname = "WS-01",
                        Status = "online",
                    },
                ],
            },
        };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.NotEmpty(model.Computers.Items);

        await ((NativeAsyncCommand)model.LogoutCommand).ExecuteAsync(null);

        Assert.Empty(model.Computers.Items);
        Assert.Null(model.Computers.Detail);
        Assert.Null(model.Computers.SelectedItem);
        Assert.Equal(HubShellState.SignedOut, model.State);
    }

    // ---- База ITINVENT ----

    [Fact]
    public async Task NavigateToPageCommandSwitchesToDatabasePage()
    {
        var api = new FakeHubApiClient { StoredSession = Session };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.True(model.IsDashboardPage);

        model.NavigateToPageCommand.Execute("database");

        Assert.True(model.IsDatabasePage);
        Assert.Same(model.Database, model.CurrentPage);
        Assert.False(model.IsDashboardPage);
    }

    [Fact]
    public async Task InitializeLoadsDatabaseTypesWithoutSearch()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            EquipmentTypes =
            [
                new HubEquipmentType { CiType = 1, TypeNo = 101, TypeName = "Ноутбук" },
                new HubEquipmentType { CiType = 4, TypeNo = 401, TypeName = "Картридж" },
            ],
        };
        var model = new HubShellViewModel(api);

        await model.InitializeAsync();

        // Справочник типов прочитан (только оборудование ci_type=1), но поиск
        // без запроса на сервер не уходит — пустая выдача в срез не входит.
        Assert.Equal(1, api.EquipmentTypesCallCount);
        Assert.Equal(0, api.EquipmentSearchCallCount);
        Assert.Equal(2, model.Database.TypeFilterOptions.Count);
    }

    [Fact]
    public async Task DatabaseTypesErrorGoesToPageBannerNotShell()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            EquipmentTypesException = new HubApiException(HubApiErrorKind.Transport, "network down"),
        };
        var model = new HubShellViewModel(api);

        await model.InitializeAsync();

        // Ошибка справочника не блокирует страницу — поиск остаётся без фильтра типа.
        Assert.Equal(HubShellState.Ready, model.State);
        Assert.False(model.Database.HasBannerError);
    }

    [Fact]
    public async Task LogoutResetsDatabasePage()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            EquipmentSearchPageFactory = _ => new HubEquipmentSearchPage
            {
                Total = 1,
                Page = 1,
                Pages = 1,
                Equipment =
                [
                    new HubEquipmentItem
                    {
                        Id = 5,
                        InvNo = 100234,
                        ModelName = "ThinkPad T14",
                        StatusName = "В работе",
                    },
                ],
            },
        };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        model.Database.DelayAsync = (_, _) => Task.CompletedTask;
        model.Database.SearchText = "thinkpad";
        await WaitFor(() => model.Database.Items.Count == 1);
        Assert.NotEmpty(model.Database.Items);

        await ((NativeAsyncCommand)model.LogoutCommand).ExecuteAsync(null);

        Assert.Empty(model.Database.Items);
        Assert.Null(model.Database.Detail);
        Assert.Null(model.Database.SelectedItem);
        Assert.Equal(string.Empty, model.Database.SearchText);
        Assert.Equal(HubShellState.SignedOut, model.State);
    }

    // ---- Доступ к группам ----

    [Fact]
    public async Task NavigateToPageCommandSwitchesToGroupsAccessPage()
    {
        var api = new FakeHubApiClient { StoredSession = Session };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.True(model.IsDashboardPage);

        model.NavigateToPageCommand.Execute("groupsaccess");

        Assert.True(model.IsGroupsAccessPage);
        Assert.Same(model.GroupsAccess, model.CurrentPage);
        Assert.False(model.IsDashboardPage);
    }

    [Fact]
    public async Task InitializeLoadsGroupsAccessPage()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            GroupsAccessStatus = new HubGroupsAccessStatus
            {
                Status = "ok",
                Branches = ["SPb", "Tyumen"],
            },
            GroupsAccessMatrix = new HubGroupsAccessMatrixGrid
            {
                Groups =
                [
                    new HubGroupsAccessGroup
                    {
                        Dn = "CN=DL-Folder-Read,OU=Groups,DC=corp,DC=local",
                        Cn = "DL-Folder-Read",
                        FolderLabel = "Папка общая",
                        AccessLevel = "read",
                    },
                ],
                Users =
                [
                    new HubGroupsAccessUser { Login = "ivanov", DisplayName = "Иван Иванов" },
                ],
                Cells = [["ivanov", "CN=DL-Folder-Read,OU=Groups,DC=corp,DC=local", "read"]],
            },
        };
        var model = new HubShellViewModel(api);

        await model.InitializeAsync();

        var group = Assert.Single(model.GroupsAccess.MatrixGroups);
        Assert.Equal("Папка общая", group.Title);
        var row = Assert.Single(model.GroupsAccess.MatrixRows);
        Assert.Equal("R", row.Cells[0].Mark);
        Assert.NotEmpty(api.GroupsAccessMatrixQueries);
    }

    [Fact]
    public async Task GroupsAccessLoadErrorGoesToPageBannerNotShell()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            GroupsAccessMatrixException = new HttpRequestException("boom"),
        };
        var model = new HubShellViewModel(api);

        await model.InitializeAsync();

        // Ошибка страницы — в её баннере, шелл остаётся готовым.
        Assert.Equal(HubShellState.Ready, model.State);
        Assert.True(model.GroupsAccess.HasBannerError);
        Assert.False(model.GroupsAccess.IsLoading);
    }

    [Fact]
    public async Task LogoutResetsGroupsAccessPage()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            GroupsAccessMatrix = new HubGroupsAccessMatrixGrid
            {
                Groups =
                [
                    new HubGroupsAccessGroup
                    {
                        Dn = "CN=DL-A,OU=Groups,DC=corp,DC=local",
                        Cn = "DL-A",
                        FolderLabel = "Папка",
                    },
                ],
            },
        };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.NotEmpty(model.GroupsAccess.MatrixGroups);

        await ((NativeAsyncCommand)model.LogoutCommand).ExecuteAsync(null);

        Assert.Empty(model.GroupsAccess.MatrixGroups);
        Assert.Empty(model.GroupsAccess.MatrixRows);
        Assert.Null(model.GroupsAccess.Detail);
        Assert.Equal(HubShellState.SignedOut, model.State);
    }

    // ---- Терминалы ВКС ----

    [Fact]
    public async Task NavigateToPageCommandSwitchesToVcsPage()
    {
        var api = new FakeHubApiClient { StoredSession = Session };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.True(model.IsDashboardPage);

        model.NavigateToPageCommand.Execute("vcs");

        Assert.True(model.IsVcsPage);
        Assert.Same(model.Vcs, model.CurrentPage);
        Assert.False(model.IsDashboardPage);
    }

    [Fact]
    public async Task InitializeLoadsVcsComputers()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            VcsComputers =
            [
                new HubVcsComputer
                {
                    Id = "c-1",
                    Name = "Переговорная 1",
                    IpAddress = "10.0.0.5",
                },
            ],
        };
        var model = new HubShellViewModel(api);

        await model.InitializeAsync();

        var item = Assert.Single(model.Vcs.Items);
        Assert.Equal("Переговорная 1", item.Title);
        Assert.Equal("10.0.0.5", item.AddressText);
        Assert.Equal(1, api.VcsComputersCallCount);
    }

    [Fact]
    public async Task LogoutResetsVcsPage()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            VcsComputers =
            [
                new HubVcsComputer { Id = "c-1", Name = "Переговорная", IpAddress = "10.0.0.5" },
            ],
        };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.NotEmpty(model.Vcs.Items);

        await ((NativeAsyncCommand)model.LogoutCommand).ExecuteAsync(null);

        Assert.Empty(model.Vcs.Items);
        Assert.Equal(HubShellState.SignedOut, model.State);
    }

    // ---- Мониторинг ----

    [Fact]
    public async Task NavigateToPageCommandSwitchesToMonitoringPage()
    {
        var api = new FakeHubApiClient { StoredSession = Session };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.True(model.IsDashboardPage);

        model.NavigateToPageCommand.Execute("monitoring");

        Assert.True(model.IsMonitoringPage);
        Assert.Same(model.Monitoring, model.CurrentPage);
        Assert.False(model.IsDashboardPage);
    }

    [Fact]
    public async Task InitializeLoadsMonitoringTargets()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
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
                            CheckedAt = DateTimeOffset.UtcNow.ToString("o"),
                            SnmpStatus = "ok",
                        },
                    },
                ],
            },
        };
        var model = new HubShellViewModel(api);

        await model.InitializeAsync();

        var item = Assert.Single(model.Monitoring.Items);
        Assert.Equal("Москва", item.Title);
        Assert.Equal("В сети", item.StatusText);
        Assert.Equal(1, api.MonitoringOverviewCallCount);
    }

    [Fact]
    public async Task MonitoringLoadErrorGoesToPageBannerNotShell()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            MonitoringOverviewException = new HttpRequestException("boom"),
        };
        var model = new HubShellViewModel(api);

        await model.InitializeAsync();

        // Ошибка страницы — в её баннере, шелл остаётся готовым.
        Assert.Equal(HubShellState.Ready, model.State);
        Assert.True(model.Monitoring.HasBannerError);
        Assert.False(model.Monitoring.IsLoading);
    }

    [Fact]
    public async Task LogoutResetsMonitoringPage()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            MonitoringOverview = new HubMonitoringOverview
            {
                Targets =
                [
                    new HubMonitoringTarget { Id = "t-1", Name = "MSK", Enabled = true },
                ],
            },
        };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.NotEmpty(model.Monitoring.Items);

        await ((NativeAsyncCommand)model.LogoutCommand).ExecuteAsync(null);

        Assert.Empty(model.Monitoring.Items);
        Assert.Null(model.Monitoring.Detail);
        Assert.Null(model.Monitoring.SelectedTarget);
        Assert.Equal(HubShellState.SignedOut, model.State);
    }

    // ---- МФУ ----

    [Fact]
    public async Task NavigateToPageCommandSwitchesToMfuPage()
    {
        var api = new FakeHubApiClient { StoredSession = Session };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.True(model.IsDashboardPage);

        model.NavigateToPageCommand.Execute("mfu");

        Assert.True(model.IsMfuPage);
        Assert.Same(model.Mfu, model.CurrentPage);
        Assert.False(model.IsDashboardPage);
    }

    [Fact]
    public async Task InitializeLoadsMfuDevices()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            MfuDevices = new HubMfuDeviceList
            {
                DbId = "main",
                Totals = new HubMfuTotals { Devices = 1, Online = 1, SnmpOk = 1 },
                Grouped = new Dictionary<string, Dictionary<string, List<HubMfuDevice>>>
                {
                    ["ЦО"] = new()
                    {
                        ["Кабинет 101"] =
                        [
                            new HubMfuDevice
                            {
                                Key = "main|1",
                                ModelName = "HP LaserJet M404",
                                Runtime = new HubMfuRuntime
                                {
                                    Ping = new HubMfuPing { Status = "online" },
                                },
                            },
                        ],
                    },
                },
            },
        };
        var model = new HubShellViewModel(api);

        await model.InitializeAsync();

        var device = Assert.IsType<MfuDeviceItemViewModel>(
            Assert.Single(model.Mfu.Items.OfType<MfuDeviceItemViewModel>()));
        Assert.Equal("HP LaserJet M404", device.Title);
        Assert.Equal("В сети", device.PingStatusText);
        Assert.Equal(1, api.MfuDevicesCallCount);
    }

    [Fact]
    public async Task MfuLoadErrorGoesToPageBannerNotShell()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            MfuDevicesException = new HttpRequestException("boom"),
        };
        var model = new HubShellViewModel(api);

        await model.InitializeAsync();

        // Ошибка страницы — в её баннере, шелл остаётся готовым.
        Assert.Equal(HubShellState.Ready, model.State);
        Assert.True(model.Mfu.HasBannerError);
        Assert.False(model.Mfu.IsLoading);
    }

    [Fact]
    public async Task LogoutResetsMfuPage()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            MfuDevices = new HubMfuDeviceList
            {
                Totals = new HubMfuTotals { Devices = 1 },
                Grouped = new Dictionary<string, Dictionary<string, List<HubMfuDevice>>>
                {
                    ["ЦО"] = new()
                    {
                        ["101"] = [new HubMfuDevice { Key = "main|1", ModelName = "HP" }],
                    },
                },
            },
        };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.NotEmpty(model.Mfu.Items);

        await ((NativeAsyncCommand)model.LogoutCommand).ExecuteAsync(null);

        Assert.Empty(model.Mfu.Items);
        Assert.Null(model.Mfu.Detail);
        Assert.Null(model.Mfu.SelectedDevice);
        Assert.Equal(HubShellState.SignedOut, model.State);
    }

    // ---- Статистика ----

    [Fact]
    public async Task NavigateToPageCommandSwitchesToStatisticsPage()
    {
        var api = new FakeHubApiClient { StoredSession = Session };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.True(model.IsDashboardPage);

        model.NavigateToPageCommand.Execute("statistics");

        Assert.True(model.IsStatisticsPage);
        Assert.Same(model.Statistics, model.CurrentPage);
        Assert.False(model.IsDashboardPage);
    }

    [Fact]
    public async Task InitializeLoadsStatistics()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            PcCleaningStatistics = new HubPcCleaningStatistics
            {
                GeneratedAt = DateTimeOffset.UtcNow.ToString("o"),
                PeriodDays = 90,
                Totals = new HubPcCleaningStatisticsTotals
                {
                    TotalPc = 10,
                    CleanedPc = 7,
                    RemainingPc = 3,
                    CoveragePercent = 70,
                    CleaningsPeriod = 9,
                },
                Branches =
                [
                    new HubPcCleaningBranchStat { Branch = "ЦО", TotalPc = 6, CleanedPc = 5 },
                ],
            },
        };
        var model = new HubShellViewModel(api);

        await model.InitializeAsync();

        Assert.Equal("Статистика чистки ПК", model.Statistics.TitleText);
        Assert.Equal(5, model.Statistics.MetricCards.Count);
        var row = Assert.Single(model.Statistics.PcBranches);
        Assert.Equal("ЦО", row.Branch);
        Assert.Equal([90], api.PcCleaningStatisticsCalls);
    }

    [Fact]
    public async Task StatisticsLoadErrorGoesToPageBannerNotShell()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            PcCleaningStatisticsException = new HttpRequestException("boom"),
        };
        var model = new HubShellViewModel(api);

        await model.InitializeAsync();

        // Ошибка страницы — в её баннере, шелл остаётся готовым.
        Assert.Equal(HubShellState.Ready, model.State);
        Assert.True(model.Statistics.HasBannerError);
        Assert.False(model.Statistics.IsLoading);
    }

    [Fact]
    public async Task LogoutResetsStatisticsPage()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            PcCleaningStatistics = new HubPcCleaningStatistics
            {
                Totals = new HubPcCleaningStatisticsTotals { TotalPc = 10, CleanedPc = 7 },
                Branches = [new HubPcCleaningBranchStat { Branch = "ЦО" }],
            },
        };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.NotEmpty(model.Statistics.PcBranches);
        model.Statistics.SearchText = "ЦО";

        await ((NativeAsyncCommand)model.LogoutCommand).ExecuteAsync(null);

        Assert.Empty(model.Statistics.PcBranches);
        Assert.Empty(model.Statistics.MetricCards);
        Assert.Equal(string.Empty, model.Statistics.SearchText);
        Assert.Equal(HubShellState.SignedOut, model.State);
    }

    // ---- Помощь (база знаний) ----

    [Fact]
    public async Task NavigateToPageCommandSwitchesToHelpPage()
    {
        var api = new FakeHubApiClient { StoredSession = Session };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.True(model.IsDashboardPage);

        model.NavigateToPageCommand.Execute("help");

        Assert.True(model.IsHelpPage);
        Assert.Same(model.Help, model.CurrentPage);
        Assert.False(model.IsDashboardPage);
    }

    [Fact]
    public async Task LogoutResetsHelpPage()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            KbCategories = [new HubKbCategory { Id = "mail", Title = "Почта" }],
            KbArticlesPage = new HubKbArticleListPage
            {
                Items =
                [
                    new HubKbArticle
                    {
                        Id = "a1",
                        Title = "Настройка почты",
                        Category = "mail",
                        Status = "published",
                    },
                ],
            },
        };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.NotEmpty(model.Help.RootNodes);

        await ((NativeAsyncCommand)model.LogoutCommand).ExecuteAsync(null);

        Assert.Empty(model.Help.RootNodes);
        Assert.Null(model.Help.SelectedNode);
        Assert.Null(model.Help.Detail);
        Assert.Equal(string.Empty, model.Help.SearchText);
        Assert.Equal(HubShellState.SignedOut, model.State);
    }

    // ---- Профиль ----

    [Fact]
    public async Task NavigateToPageCommandSwitchesToProfilePage()
    {
        var api = new FakeHubApiClient { StoredSession = Session };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.True(model.IsDashboardPage);

        model.NavigateToPageCommand.Execute(HubShellViewModel.ProfilePageId);

        Assert.True(model.IsProfilePage);
        Assert.Same(model.Profile, model.CurrentPage);
        Assert.False(model.IsDashboardPage);
    }

    [Fact]
    public async Task ProfilePageShowsSessionUserAndAppInfo()
    {
        var api = new FakeHubApiClient { StoredSession = Session };
        var model = new HubShellViewModel(api);

        await model.InitializeAsync();

        var profile = model.Profile;
        Assert.Equal("Иван Иванов", profile.DisplayName);
        Assert.Equal("ivanov", profile.UserName);
        Assert.Equal("ИИ", profile.Initials);
        Assert.Equal("desktop-test", profile.DeviceIdText);
        Assert.False(string.IsNullOrWhiteSpace(profile.SessionExpiresText));
        Assert.Equal("https://hubit.zsgp.ru", profile.ServerText);
        Assert.False(string.IsNullOrWhiteSpace(profile.AppVersionText));
    }

    [Fact]
    public async Task ProfileFallsBackToLoginWhenFullNameEmpty()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session with { FullName = "" },
        };
        var model = new HubShellViewModel(api);

        await model.InitializeAsync();

        Assert.Equal("ivanov", model.Profile.DisplayName);
    }

    [Fact]
    public async Task ProfileSignOutRunsShellLogoutAndClearsCard()
    {
        var api = new FakeHubApiClient { StoredSession = Session };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.Equal(HubShellState.Ready, model.State);

        await ((NativeAsyncCommand)model.Profile.SignOutCommand).ExecuteAsync(null);

        Assert.Equal(HubShellState.SignedOut, model.State);
        Assert.Null(api.CurrentSession);
        Assert.Equal(string.Empty, model.Profile.DisplayName);
        Assert.Equal(string.Empty, model.Profile.UserName);
    }

    // ---- Настройки ----

    [Fact]
    public async Task NavigateToPageCommandSwitchesToSettingsPage()
    {
        var api = new FakeHubApiClient { StoredSession = Session };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.True(model.IsDashboardPage);

        model.NavigateToPageCommand.Execute(HubShellViewModel.SettingsPageId);

        Assert.True(model.IsSettingsPage);
        Assert.Same(model.Settings, model.CurrentPage);
        Assert.False(model.IsDashboardPage);
    }

    // ---- Администрирование ----

    [Fact]
    public async Task NavigateToPageCommandSwitchesToAdminPage()
    {
        var api = new FakeHubApiClient { StoredSession = Session };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.True(model.IsDashboardPage);

        model.NavigateToPageCommand.Execute("admin");

        Assert.True(model.IsAdminPage);
        Assert.Same(model.Admin, model.CurrentPage);
        Assert.False(model.IsDashboardPage);
    }

    [Fact]
    public async Task InitializeLoadsAdminPageForAdminUser()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            CurrentUser = new HubUser { Id = 1, Username = "root", Role = "admin" },
            AdminUsers =
            [
                new HubAdminUser { Id = 1, Username = "ivanov", FullName = "Иван Иванов" },
            ],
        };
        var model = new HubShellViewModel(api);

        await model.InitializeAsync();

        Assert.NotEmpty(model.Admin.Sections);
        Assert.Single(model.Admin.Users);
        Assert.False(model.Admin.ShowAccessDenied);
    }

    [Fact]
    public async Task InitializeAdminPageShowsDeniedHintForRegularUser()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            // CurrentUser по умолчанию — viewer без админ-прав.
            CurrentUser = new HubUser { Id = 7, Username = "ivanov", Role = "viewer" },
        };
        var model = new HubShellViewModel(api);

        await model.InitializeAsync();

        Assert.Equal(HubShellState.Ready, model.State);
        Assert.True(model.Admin.ShowAccessDenied);
        Assert.False(model.Admin.HasBannerError);
    }

    [Fact]
    public async Task LogoutResetsAdminPage()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            CurrentUser = new HubUser { Id = 1, Username = "root", Role = "admin" },
            AdminUsers =
            [
                new HubAdminUser { Id = 1, Username = "ivanov" },
            ],
        };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.NotEmpty(model.Admin.Users);

        await ((NativeAsyncCommand)model.LogoutCommand).ExecuteAsync(null);

        Assert.Empty(model.Admin.Sections);
        Assert.Empty(model.Admin.Users);
        Assert.Equal(HubShellState.SignedOut, model.State);
    }

    [Fact]
    public async Task LogoutResetsSettingsPage()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            MySettings = new HubUserSettings { ThemeMode = "dark", FontFamily = "Inter" },
        };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.Equal("dark", model.Settings.ThemeMode);
        model.Settings.IsSecuritySection = true;

        await ((NativeAsyncCommand)model.LogoutCommand).ExecuteAsync(null);

        Assert.True(model.Settings.IsThemeSystem);
        Assert.True(model.Settings.IsAppearanceSection);
        Assert.Equal(HubShellState.SignedOut, model.State);
    }

    // ---- Дашборд ----

    [Fact]
    public async Task DashboardPopulatesListsAndCards()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            Dashboard = Dashboard(
                summary: new HubDashboardSummary
                {
                    TasksOverdue = 2,
                    TasksReviewRequired = 1,
                    TasksOpenTotal = 9,
                    AnnouncementsAttention = 4,
                    AbsencesToday = 3,
                },
                tasks: [MakeTask(1, "Ближняя", "in_progress", dueAt: DateTimeOffset.UtcNow.AddDays(1))],
                announcements:
                [
                    new HubAnnouncement
                    {
                        Id = "10",
                        Title = "Плановые работы",
                        Preview = "В субботу обновление",
                        IsAckPending = true,
                        PublishedAt = DateTimeOffset.UtcNow,
                    },
                ],
                absences:
                [
                    new HubAbsenceItem
                    {
                        DisplayName = "Пётр Петров",
                        Kind = "vacation",
                        StartsOn = "2026-11-16",
                        EndsOn = "2026-11-20",
                        Source = "zup",
                    },
                ]),
            TasksPage = PageOf(),
        };
        var model = new HubShellViewModel(api);

        await model.InitializeAsync();

        Assert.Equal("2", model.Dashboard.StatCards[0].ValueText);
        Assert.Equal("overdue", model.Dashboard.StatCards[0].TaskFilterToOpen);
        Assert.Equal("9", model.Dashboard.StatCards[2].ValueText);
        Assert.Null(model.Dashboard.StatCards[4].TaskFilterToOpen);
        Assert.True(model.Dashboard.HasUpcomingTasks);
        var announcement = Assert.Single(model.Dashboard.Announcements);
        Assert.Equal("Плановые работы", announcement.Title);
        Assert.True(announcement.IsImportant);
        var absence = Assert.Single(model.Dashboard.Absences);
        Assert.Equal("Пётр Петров", absence.DisplayName);
        Assert.Equal("Отпуск", absence.KindLabel);
        Assert.Equal("ЗУП", absence.SourceText);
    }

    [Fact]
    public async Task DashboardErrorIsSurfacedWithoutBreakingTasksPage()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            DashboardException = new HubApiException(HubApiErrorKind.Transport, "down"),
            TasksPage = PageOf(MakeTask(1, "A", "new")),
        };
        var model = new HubShellViewModel(api);

        await model.InitializeAsync();

        Assert.Equal(HubShellState.Ready, model.State);
        Assert.True(model.Dashboard.HasError);
        Assert.Contains("соединения", model.Dashboard.ErrorText, StringComparison.OrdinalIgnoreCase);
        Assert.Single(model.Tasks.Items);
    }

    [Fact]
    public async Task OpenTaskFromDashboardNavigatesToTasksPage()
    {
        var dashboardTask = MakeTask(7, "Из дашборда", "new");
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            Dashboard = Dashboard(tasks: [dashboardTask]),
            TasksPage = PageOf(dashboardTask),
            TaskDetail = Detail(7, "Из дашборда", "new"),
        };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();

        model.Dashboard.OpenTaskCommand.Execute(model.Dashboard.UpcomingTasks[0]);
        await WaitFor(() => model.Tasks.SelectedItem?.Id == 7 && model.Tasks.Detail is not null);

        Assert.True(model.IsTasksPage);
        Assert.Equal("Из дашборда", model.Tasks.Detail!.Title);
    }

    [Fact]
    public async Task OpenNewsFromDashboardNavigatesToNewsPage()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            Dashboard = Dashboard(announcements:
            [
                new HubAnnouncement
                {
                    Id = "n42",
                    Title = "Целевая новость",
                    Preview = "Анонс",
                    PublishedAt = DateTimeOffset.UtcNow,
                },
            ]),
            TasksPage = PageOf(),
            AnnouncementsPage = new HubAnnouncementListPage
            {
                Items = [new HubAnnouncementItem { Id = "n42", Title = "Целевая новость" }],
                Total = 1,
            },
            AnnouncementDetail = new HubAnnouncementItem
            {
                Id = "n42",
                Title = "Целевая новость",
                Body = "Полный текст",
            },
        };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();

        model.Dashboard.OpenNewsCommand.Execute(model.Dashboard.Announcements[0]);
        await WaitFor(() => model.News.SelectedItem?.Id == "n42" && model.News.Detail is not null);

        Assert.True(model.IsNewsPage);
        Assert.Equal("Целевая новость", model.News.Detail!.Title);
    }

    [Fact]
    public async Task StatCardClickNavigatesToFilteredTasks()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            Dashboard = Dashboard(summary: new HubDashboardSummary { TasksOverdue = 1 }),
            TasksPage = PageOf(),
        };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();

        await ((NativeAsyncCommand)model.OpenStatCardCommand)
            .ExecuteAsync(model.Dashboard.StatCards[0]);

        Assert.True(model.IsTasksPage);
        Assert.True(model.Tasks.IsFilterOverdue);
        Assert.Equal("overdue", api.LastQuery?.DueState);
    }

    [Fact]
    public async Task StatCardClickNavigatesToTargetPage()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            Dashboard = Dashboard(summary: new HubDashboardSummary
            {
                AnnouncementsAttention = 4,
                AbsencesToday = 3,
            }),
            TasksPage = PageOf(),
        };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();

        var newsCard = model.Dashboard.StatCards[3];
        var absencesCard = model.Dashboard.StatCards[4];
        Assert.Equal("news", newsCard.PageToOpen);
        Assert.Equal("absences", absencesCard.PageToOpen);
        Assert.True(newsCard.IsNavigable);
        Assert.True(absencesCard.IsNavigable);

        await ((NativeAsyncCommand)model.OpenStatCardCommand).ExecuteAsync(newsCard);
        Assert.True(model.IsNewsPage);

        await ((NativeAsyncCommand)model.OpenStatCardCommand).ExecuteAsync(absencesCard);
        Assert.True(model.IsAbsencesPage);
    }

    [Fact]
    public async Task RefreshCurrentPageCommandReloadsActivePage()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            Dashboard = Dashboard(),
            TasksPage = PageOf(MakeTask(1, "A", "new")),
        };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        var dashboardCalls = api.DashboardCallCount;

        model.RefreshCurrentPageCommand.Execute(null);
        await WaitFor(() => api.DashboardCallCount > dashboardCalls);

        // На странице задач обновляет задачи, а не дашборд.
        model.NavigateToPageCommand.Execute("tasks");
        var dashboardCallsAfterNav = api.DashboardCallCount;
        var tasksCalls = api.TasksCallCount;
        model.RefreshCurrentPageCommand.Execute(null);
        await WaitFor(() => api.TasksCallCount > tasksCalls);

        Assert.Equal(dashboardCallsAfterNav, api.DashboardCallCount);
    }

    [Fact]
    public async Task NavBadgesReflectUnreadNewsAndChat()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            TasksPage = PageOf(),
            AnnouncementsPage = new HubAnnouncementListPage
            {
                Items = [new HubAnnouncementItem { Id = "n1", Title = "Новость" }],
                Total = 1,
                UnreadTotal = 5,
            },
            ChatConversations = new HubChatConversationList
            {
                Items =
                [
                    new HubChatConversation { Id = "c1", Title = "Первый", UnreadCount = 3 },
                    new HubChatConversation { Id = "c2", Title = "Второй", UnreadCount = 2 },
                ],
            },
        };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();

        Assert.True(model.HasNewsUnread);
        Assert.Equal("5", model.NewsUnreadBadgeText);
        Assert.True(model.HasChatUnread);
        Assert.Equal("5", model.ChatUnreadBadgeText);
    }

    [Fact]
    public async Task NewsBadgeClearsAfterReadingLastUnreadItem()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            TasksPage = PageOf(),
            AnnouncementsPage = new HubAnnouncementListPage
            {
                Items = [new HubAnnouncementItem { Id = "n1", Title = "Новость", IsUnread = true }],
                Total = 1,
                UnreadTotal = 1,
            },
            AnnouncementDetail = new HubAnnouncementItem { Id = "n1", Title = "Новость" },
        };
        var model = new HubShellViewModel(api);
        await model.InitializeAsync();
        Assert.True(model.HasNewsUnread);

        // Карточка «Непрочитанных новостей» на дашборде синхронизирована со страницей.
        Assert.Equal(
            "1",
            model.Dashboard.StatCards.First(c => c.PageToOpen == "news").ValueText);

        await model.News.SelectNewsByIdAsync("n1");
        await WaitFor(() => !model.HasNewsUnread);

        Assert.Equal(string.Empty, model.NewsUnreadBadgeText);
        Assert.Equal(
            "0",
            model.Dashboard.StatCards.First(c => c.PageToOpen == "news").ValueText);
    }

    [Theory]
    [InlineData("/tasks", "tasks")]
    [InlineData("/tasks?task=7", "tasks")]
    [InlineData("/chat", "chat")]
    [InlineData("/feed", "news")]
    [InlineData("/dashboard", "dashboard")]
    [InlineData("/", "dashboard")]
    [InlineData("/mail", "mail")]
    [InlineData("/docflow", "docflow")]
    [InlineData("/my-files", "myfiles")]
    [InlineData("/tickets", "tickets")]
    [InlineData("/tickets?request=42", "tickets")]
    [InlineData("/address-book", "addressbook")]
    [InlineData("/address-book?q=ivan", "addressbook")]
    [InlineData("/company-structure", "structure")]
    [InlineData("/company-structure?node=5", "structure")]
    [InlineData("/it/objects", "itobjects")]
    [InlineData("/it/objects?ref=ITINVENT%3A5", "itobjects")]
    [InlineData("/networks", "networks")]
    [InlineData("/networks?branch=5", "networks")]
    [InlineData("/computers", "computers")]
    [InlineData("/computers?mac=AA%3ABB", "computers")]
    [InlineData("/database", "database")]
    [InlineData("/database?inv=100234", "database")]
    [InlineData("/groups-access", "groupsaccess")]
    [InlineData("/groups-access?branch=SPb", "groupsaccess")]
    [InlineData("/vcs", "vcs")]
    [InlineData("/monitoring", "monitoring")]
    [InlineData("/monitoring?target=t-1", "monitoring")]
    [InlineData("/mfu", "mfu")]
    [InlineData("/mfu?branch=ЦО", "mfu")]
    [InlineData("/statistics", "statistics")]
    [InlineData("/statistics?tab=battery", "statistics")]
    [InlineData("/help", "help")]
    [InlineData("/help?article=5", "help")]
    [InlineData("/kb", "help")]
    [InlineData("/settings", "settings")]
    [InlineData("/settings?section=notifications", "settings")]
    [InlineData("/admin", "admin")]
    [InlineData("/admin/users", "admin")]
    [InlineData("/admin/ad-users", "admin")]
    [InlineData("/admin?section=feedback", "admin")]
    [InlineData(null, null)]
    public void TryMapWebRouteMapsKnownSections(string? route, string? page)
    {
        Assert.Equal(page, HubShellViewModel.TryMapWebRoute(route));
    }

    // ---- Страница задач ----

    [Fact]
    public async Task OverdueFilterMapsToDueStateQuery()
    {
        var api = new FakeHubApiClient { TasksPage = PageOf() };
        var model = new TasksViewModel(api);

        await ((NativeAsyncCommand)model.SelectFilterCommand)
            .ExecuteAsync("overdue");

        Assert.Equal("overdue", api.LastQuery?.DueState);
        Assert.Null(api.LastQuery?.Status);
        Assert.True(model.IsFilterOverdue);
    }

    [Fact]
    public async Task TasksLoadFailureSetsBanner()
    {
        var api = new FakeHubApiClient
        {
            TasksException = new HubApiException(HubApiErrorKind.Transport, "network down"),
        };
        var model = new TasksViewModel(api);

        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);

        Assert.Contains("соединения", model.BannerErrorText, StringComparison.OrdinalIgnoreCase);
        Assert.True(model.HasBannerError);
    }

    [Fact]
    public async Task SelectingTaskLoadsDetailWithCapabilities()
    {
        var detail = Detail(
            9,
            "Согласовать договор",
            "review",
            canReview: true);
        var api = new FakeHubApiClient
        {
            TasksPage = PageOf(MakeTask(9, "Согласовать договор", "review")),
            TaskDetail = detail,
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        Assert.NotNull(model.Detail);
        Assert.Equal("Согласовать договор", model.Detail!.Title);
        Assert.True(model.Detail.CanReview);
        Assert.True(model.Detail.HasAnyAction);
        Assert.False(model.Detail.CanStart);
    }

    [Fact]
    public async Task TransitionUpdatesDetailAndListItem()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = PageOf(MakeTask(3, "Задача", "new"), MakeTask(4, "Иная", "done")),
            TaskDetail = Detail(3, "Задача", "new", canStart: true),
            TransitionResult = Detail(3, "Задача", "in_progress"),
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null);

        Assert.True(
            model.TransitionCommand.CanExecute("Start"),
            $"CanExecute=false; Detail={model.Detail?.GetType().Name}, ActionsEnabled={model.Detail?.ActionsEnabled}, HasAnyAction={model.Detail?.HasAnyAction}");
        await ((NativeAsyncCommand)model.TransitionCommand)
            .ExecuteAsync("Start");

        Assert.Null(model.DetailErrorText);
        Assert.Equal(HubTaskTransition.Start, api.LastTransition);
        Assert.Equal("В работе", model.Detail!.StatusText);
        await WaitFor(() => model.Items[0].StatusText == "В работе");
    }

    [Fact]
    public async Task SelectTaskByIdReloadsAndSelects()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = PageOf(MakeTask(2, "Целевая", "new")),
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();

        await model.SelectTaskByIdAsync(2);

        Assert.Equal(2, model.SelectedItem?.Id);
    }

    [Fact]
    public void ListItemFormatsOverdueDueDate()
    {
        var item = new TaskListItemViewModel(MakeTask(
            1,
            "Срочная",
            "in_progress",
            dueAt: DateTimeOffset.UtcNow.AddDays(-2),
            isOverdue: true));

        Assert.StartsWith("Просрочено:", item.DueText);
        Assert.Equal("В работе", item.StatusText);
        Assert.True(item.IsOverdueVisual);
    }

    [Fact]
    public void DescribeErrorMapsApiKinds()
    {
        Assert.Equal(
            "Нет соединения с сервером HUB. Проверьте сеть и повторите попытку.",
            TasksViewModel.DescribeError(
                new HubApiException(HubApiErrorKind.Transport, "boom")));
        Assert.Equal(
            "Сессия истекла. Войдите заново.",
            TasksViewModel.DescribeError(
                new HubApiException(HubApiErrorKind.SessionExpired, "gone")));
        Assert.Equal(
            "Не удалось выполнить запрос. Повторите попытку.",
            TasksViewModel.DescribeError(new InvalidOperationException("odd")));
    }

    [Fact]
    public async Task PageSelectionSettersDriveNavigationLikeRadioSelect()
    {
        // Навигация — RadioButton-группа с TwoWay IsChecked: UIA Select()
        // и клавиатурный пробел ставят галочку, сеттер переводит страницу.
        var shell = new HubShellViewModel(new FakeHubApiClient());
        await shell.SignInAsync("secret");

        Assert.True(shell.IsDashboardPage);
        shell.IsChatPage = true;
        Assert.Same(shell.Chat, shell.CurrentPage);
        Assert.True(shell.IsChatPage);

        shell.IsAbsencesPage = true;
        Assert.Same(shell.Absences, shell.CurrentPage);
        Assert.False(shell.IsChatPage);

        shell.IsAddressBookPage = true;
        Assert.Same(shell.AddressBook, shell.CurrentPage);
        Assert.False(shell.IsAbsencesPage);

        shell.IsCompanyStructurePage = true;
        Assert.Same(shell.CompanyStructure, shell.CurrentPage);
        Assert.False(shell.IsAddressBookPage);

        shell.IsItObjectsPage = true;
        Assert.Same(shell.ItObjects, shell.CurrentPage);
        Assert.False(shell.IsCompanyStructurePage);

        shell.IsNetworksPage = true;
        Assert.Same(shell.Networks, shell.CurrentPage);
        Assert.False(shell.IsItObjectsPage);

        shell.IsHelpPage = true;
        Assert.Same(shell.Help, shell.CurrentPage);
        Assert.False(shell.IsNetworksPage);

        // value=false — не навигация, а снятие галочки при выборе соседа
        var page = shell.CurrentPage;
        shell.IsChatPage = false;
        Assert.Same(page, shell.CurrentPage);
    }

    [Fact]
    public void HubWindowRendersAllStatesOnStaThread()
    {
        // Парсинг XAML, merge HubTheme, навигация и шаблоны всех состояний
        // инстанцируются на загрузке — smoke-тест ловит битые ресурсы/стили.
        Exception? captured = null;
        using var completed = new ManualResetEventSlim();
        var thread = new Thread(() =>
        {
            try
            {
                var window = new Native.Views.HubWindow(new FakeHubApiClient())
                {
                    WindowStartupLocation = WindowStartupLocation.Manual,
                    Left = -10000,
                    Top = -10000,
                };
                window.Show();
                window.UpdateLayout();
                window.Close();
            }
            catch (Exception exception)
            {
                captured = exception;
            }
            finally
            {
                completed.Set();
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();

        Assert.True(completed.Wait(TimeSpan.FromSeconds(15)));
        thread.Join(TimeSpan.FromSeconds(1));
        Assert.Null(captured);
    }

    [Fact]
    public async Task TasksLoadMoreAppendsNextPageUntilExhausted()
    {
        var api = new FakeHubApiClient
        {
            TasksPageFactory = query => new HubTaskListPage
            {
                Total = 3,
                Items = query.Offset == 0
                    ? [MakeTask(1, "Первая", "new"), MakeTask(2, "Вторая", "new")]
                    : [MakeTask(3, "Третья", "new")],
            },
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();
        Assert.Equal(2, model.Items.Count);
        Assert.True(model.HasMore);
        Assert.Equal("Показать ещё (1)", model.MoreButtonText);

        await ((NativeAsyncCommand)model.LoadMoreCommand).ExecuteAsync(null);

        Assert.Equal(3, model.Items.Count);
        Assert.Equal(2, api.LastQuery?.Offset);
        Assert.False(model.HasMore);
    }

    [Fact]
    public async Task SelectTaskByIdLoadsExtraPagesUntilFound()
    {
        var api = new FakeHubApiClient
        {
            TasksPageFactory = query => new HubTaskListPage
            {
                Total = 3,
                Items = query.Offset == 0
                    ? [MakeTask(1, "Первая", "new"), MakeTask(2, "Вторая", "new")]
                    : [MakeTask(3, "Глубокая", "new")],
            },
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();
        Assert.DoesNotContain(model.Items, i => i.Id == 3);

        await model.SelectTaskByIdAsync(3);

        Assert.Equal(3, model.SelectedItem?.Id);
        Assert.Equal(3, model.Items.Count);
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

    private static HubTaskItem MakeTask(
        long id,
        string title,
        string status,
        DateTimeOffset? dueAt = null,
        bool isOverdue = false) =>
        new()
        {
            Id = id,
            Title = title,
            Status = status,
            DueAt = dueAt,
            IsOverdue = isOverdue,
            AssigneeFullName = "Иван Иванов",
        };

    private static HubTaskDetail Detail(
        long id,
        string title,
        string status,
        bool canStart = false,
        bool canReview = false) =>
        new()
        {
            Id = id,
            Title = title,
            Status = status,
            Description = "Описание задачи",
            AssigneeFullName = "Иван Иванов",
            Capabilities = new HubTaskCapabilities
            {
                CanStart = canStart,
                CanReview = canReview,
            },
        };

    private static HubTaskListPage PageOf(params HubTaskItem[] items) =>
        new() { Items = items, Total = items.Length, Limit = 100, Offset = 0 };

    private static HubDashboard Dashboard(
        HubDashboardSummary? summary = null,
        IReadOnlyList<HubTaskItem>? tasks = null,
        IReadOnlyList<HubAnnouncement>? announcements = null,
        IReadOnlyList<HubAbsenceItem>? absences = null) =>
        new()
        {
            GeneratedAt = DateTimeOffset.UtcNow,
            Summary = summary ?? new HubDashboardSummary(),
            MyTasks = new HubTaskListPage
            {
                Items = tasks ?? [],
                Total = tasks?.Count ?? 0,
            },
            Announcements = new HubAnnouncementList
            {
                Items = announcements ?? [],
            },
            AbsencesToday = new HubAbsenceList
            {
                Items = absences ?? [],
                Count = absences?.Count ?? 0,
            },
        };
}
