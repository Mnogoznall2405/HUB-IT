using System.Net;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NativeAdminViewModelTests
{
    private static HubUser AdminUser => new() { Id = 1, Username = "root", Role = "admin" };

    // ---- Разделы ----

    [Fact]
    public async Task AdminSeesAllSections()
    {
        var api = new FakeHubApiClient { CurrentUser = AdminUser };
        var model = new AdminViewModel(api);

        await model.LoadAsync();

        Assert.Equal(
            ["users", "departments", "ad-users", "ai-bots", "feedback", "system"],
            model.Sections.Select(s => s.Key).ToArray());
        Assert.Equal("users", model.SelectedSection?.Key);
        Assert.True(model.Sections[0].IsChecked);
        Assert.False(model.ShowAccessDenied);
    }

    [Fact]
    public async Task SectionsAreFilteredByPermissions()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = new HubUser
            {
                Id = 2,
                Username = "manager",
                Role = "operator",
                Permissions = ["departments.manage", "feedback.manage"],
            },
        };
        var model = new AdminViewModel(api);

        await model.LoadAsync();

        Assert.Equal(
            ["departments", "feedback"],
            model.Sections.Select(s => s.Key).ToArray());
        Assert.Equal("departments", model.SelectedSection?.Key);
    }

    [Fact]
    public async Task UserWithoutAdminRightsSeesDeniedHint()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = new HubUser { Id = 3, Username = "viewer", Role = "viewer" },
        };
        var model = new AdminViewModel(api);

        await model.LoadAsync();

        // Ни одного раздела — дружелюбная подсказка вместо баннера-краха.
        Assert.True(model.ShowAccessDenied);
        Assert.Empty(model.Sections);
        Assert.False(model.HasBannerError);
        Assert.False(model.IsLoading);
        // admin-эндпоинты не дёргаются без видимых разделов.
        Assert.Equal(0, api.AdminUsersCallCount);
    }

    // ---- Список и поиск ----

    [Fact]
    public async Task UsersSectionLoadsAndSearchFiltersLocally()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = AdminUser,
            AdminUsers =
            [
                new HubAdminUser
                {
                    Id = 1, Username = "ivanov", FullName = "Иван Иванов",
                    Role = "viewer", Department = "ИТ", AuthSource = "ldap",
                },
                new HubAdminUser
                {
                    Id = 2, Username = "petrov", FullName = "Пётр Петров",
                    Role = "admin", Department = "Бухгалтерия",
                },
            ],
        };
        var model = new AdminViewModel(api);

        await model.LoadAsync();

        Assert.Equal("users", model.SelectedSection?.Key);
        Assert.Equal(2, model.Users.Count);
        Assert.Equal("2 пользователя", model.TotalText);
        Assert.False(model.HasBannerError);

        model.SearchText = "петров";

        var item = Assert.Single(model.Users);
        Assert.Equal("@petrov", item.UsernameText);
        Assert.Equal("Админ", item.RoleText);

        model.SearchText = "ит";
        Assert.Single(model.Users);

        model.SearchText = string.Empty;
        Assert.Equal(2, model.Users.Count);
        // Поиск локальный — повторных запросов нет.
        Assert.Equal(1, api.AdminUsersCallCount);
    }

    [Fact]
    public async Task SectionSwitchLoadsThatSection()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = AdminUser,
            AdminAdCandidates =
            [
                new HubAdminAdCandidate
                {
                    Login = "aduser1", DisplayName = "Ад Юзер", Department = "ИТ",
                    ImportStatus = "new", Warnings = ["missing_mail"],
                },
            ],
            AdminAdSyncStatus = new HubAdminAdSyncStatus
            {
                LastSyncAt = "2026-11-20T10:00:00+03:00",
                Result = new HubAdminAdSyncResult { Created = 2, Updated = 40 },
            },
        };
        var model = new AdminViewModel(api);
        await model.LoadAsync();
        Assert.Empty(model.AdUsers);
        Assert.False(api.LastAdminDepartmentMembersId is not null);

        var section = model.Sections.First(s => s.Key == "ad-users");
        await ((NativeAsyncCommand)model.SelectSectionCommand).ExecuteAsync(section);

        Assert.True(model.IsAdUsersSection);
        Assert.True(section.IsChecked);
        var item = Assert.Single(model.AdUsers);
        Assert.Equal("Ад Юзер", item.Title);
        Assert.Equal("Новый", item.StatusText);
        Assert.True(item.HasWarnings);
        Assert.Contains("нет почты", item.WarningsText);
        Assert.Contains("Последняя синхронизация", model.SyncStatusText);
    }

    // ---- 403 / ошибки ----

    [Fact]
    public async Task ForbiddenSectionShowsHintNotBannerCrash()
    {
        // У пользователя есть право видеть раздел AD (ad_users.read),
        // но admin-only эндпоинт кандидатов отвечает 403 — подсказка вместо краха.
        var api = new FakeHubApiClient
        {
            CurrentUser = new HubUser
            {
                Id = 4,
                Username = "reader",
                Role = "viewer",
                Permissions = ["ad_users.read"],
            },
            AdminAdCandidatesException = new HubApiException(
                HubApiErrorKind.Http, "forbidden", HttpStatusCode.Forbidden),
        };
        var model = new AdminViewModel(api);

        await model.LoadAsync();

        Assert.True(model.HasSectionDenied);
        Assert.Contains("Недостаточно прав", model.SectionDeniedText);
        Assert.False(model.HasBannerError);
        Assert.False(model.ShowAccessDenied);
        Assert.False(model.IsLoading);
    }

    [Fact]
    public async Task TransportErrorGoesToBanner()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = AdminUser,
            AdminUsersException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new AdminViewModel(api);

        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);

        Assert.True(model.HasBannerError);
        Assert.Contains("соединения", model.BannerErrorText, StringComparison.OrdinalIgnoreCase);
        Assert.False(model.IsLoading);
    }

    // ---- Деталь отдела ----

    [Fact]
    public async Task DepartmentDetailLoadsMembersGroupedByUser()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = AdminUser,
            AdminDepartments = new HubAdminDepartmentList
            {
                Items = [new HubAdminDepartment { Id = "d1", Name = "ИТ", MembersCount = 2 }],
            },
            AdminDepartmentMembers = new HubAdminDepartmentMembers
            {
                Items =
                [
                    new HubAdminDepartmentMember
                    {
                        UserId = 1, Role = "manager",
                        User = new HubAdminDepartmentMemberUser { Username = "boss", FullName = "Босс" },
                    },
                    new HubAdminDepartmentMember
                    {
                        UserId = 1, Role = "member",
                        User = new HubAdminDepartmentMemberUser { Username = "boss", FullName = "Босс" },
                    },
                    new HubAdminDepartmentMember
                    {
                        UserId = 2, Role = "member",
                        User = new HubAdminDepartmentMemberUser { Username = "worker", FullName = "Рабочий" },
                    },
                ],
            },
        };
        var model = new AdminViewModel(api);
        await model.LoadAsync();

        var section = model.Sections.First(s => s.Key == "departments");
        await ((NativeAsyncCommand)model.SelectSectionCommand).ExecuteAsync(section);
        await WaitFor(() => model.DepartmentMembers.Count > 0);

        Assert.Equal("d1", api.LastAdminDepartmentMembersId);
        Assert.Equal(2, model.DepartmentMembers.Count);
        // Две membership-записи user_id=1 схлопываются в одного участника с двумя ролями.
        var boss = model.DepartmentMembers.First(m => m.UserId == 1);
        Assert.Contains("начальник", boss.RolesText);
        Assert.Contains("участник", boss.RolesText);
    }

    // ---- Фильтр предложений ----

    [Fact]
    public async Task FeedbackSectionLoadsAndStatusChipFilters()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = AdminUser,
            AdminFeedbackPage = new HubAdminFeedbackPage
            {
                Total = 3,
                Counts = new Dictionary<string, int> { ["new"] = 2, ["done"] = 1 },
                Items =
                [
                    new HubAdminFeedbackItem
                    {
                        Id = "f1", Title = "Добавить поиск", Status = "new", Category = "idea",
                        Author = new HubAdminFeedbackAuthor { Username = "ivanov" },
                    },
                    new HubAdminFeedbackItem
                    {
                        Id = "f2", Title = "Медленная почта", Status = "new", Category = "bug",
                    },
                    new HubAdminFeedbackItem
                    {
                        Id = "f3", Title = "Тёмная тема", Status = "done", Category = "idea",
                    },
                ],
            },
        };
        var model = new AdminViewModel(api);
        await model.LoadAsync();

        var section = model.Sections.First(s => s.Key == "feedback");
        await ((NativeAsyncCommand)model.SelectSectionCommand).ExecuteAsync(section);

        Assert.Equal(3, model.FeedbackItems.Count);
        Assert.Equal("Все (3)", model.FeedbackChips[0].LabelText);
        Assert.Equal("Новое (2)", model.FeedbackChips[1].LabelText);
        Assert.Equal("3 предложения", model.TotalText);

        model.FeedbackChips.First(c => c.Value == "new").IsChecked = true;

        Assert.Equal("new", model.SelectedFeedbackStatus);
        Assert.Equal(2, model.FeedbackItems.Count);
        Assert.All(model.FeedbackItems, i => Assert.Equal("new", i.Status));

        // Локальный поиск поверх статуса.
        model.SearchText = "почта";
        var item = Assert.Single(model.FeedbackItems);
        Assert.Equal("Медленная почта", item.Title);
    }

    // ---- Система ----

    [Fact]
    public async Task SystemSectionShowsMetricsSummaryAndRoutes()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = AdminUser,
            AdminRequestMetrics = new HubAdminRequestMetrics
            {
                Enabled = true,
                TotalRequests = 1200,
                RouteCount = 2,
                TotalServerErrors = 3,
                ServerErrorRate = 0.0025,
                Routes =
                [
                    new HubAdminRouteStat
                    {
                        Method = "GET", Path = "/api/v1/tasks",
                        Count = 800, P95Ms = 42,
                    },
                    new HubAdminRouteStat
                    {
                        Method = "POST", Path = "/api/v1/auth/login",
                        Count = 400, ServerErrorCount = 3, P95Ms = 120,
                    },
                ],
            },
        };
        var model = new AdminViewModel(api);
        await model.LoadAsync();

        var section = model.Sections.First(s => s.Key == "system");
        await ((NativeAsyncCommand)model.SelectSectionCommand).ExecuteAsync(section);

        Assert.Equal(2, model.Routes.Count);
        Assert.Contains("1200", model.MetricsSummaryText);
        Assert.Contains("маршрутов: 2", model.MetricsSummaryText);
        Assert.Equal("error", model.Routes[1].ServerErrorsTone);
        Assert.Equal("muted", model.Routes[0].ServerErrorsTone);
    }

    // ---- Reset ----

    [Fact]
    public async Task ResetClearsSectionsAndData()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = AdminUser,
            AdminUsers = [new HubAdminUser { Id = 1, Username = "u1", FullName = "Один" }],
        };
        var model = new AdminViewModel(api);
        await model.LoadAsync();
        Assert.NotEmpty(model.Users);
        model.SearchText = "один";

        model.Reset();

        Assert.Empty(model.Sections);
        Assert.Empty(model.Users);
        Assert.Null(model.SelectedSection);
        Assert.Equal(string.Empty, model.SearchText);
        Assert.False(model.ShowAccessDenied);
        Assert.False(model.HasBannerError);

        // Права перепроверяются при следующей загрузке.
        await model.LoadAsync();
        Assert.NotEmpty(model.Sections);
        Assert.Single(model.Users);
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
