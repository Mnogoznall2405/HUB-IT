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
            ["users", "departments", "ad-users", "ai-bots", "feedback", "news", "mail-quotas", "system"],
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

    // ---- Пользователи: write-флоу ----

    private static HubAdminUser TargetUser => new()
    {
        Id = 42,
        Username = "petrov",
        FullName = "Пётр Петров",
        Email = "petrov@zsgp.ru",
        Department = "ИТ",
        JobTitle = "Инженер",
        Role = "viewer",
        IsActive = true,
        IsTwoFactorEnabled = true,
    };

    [Fact]
    public async Task EditUserPatchesOnlyChangedFields()
    {
        var api = new FakeHubApiClient { CurrentUser = AdminUser, AdminUsers = [TargetUser] };
        var model = new AdminViewModel(api);
        await model.LoadAsync();

        model.EditUserCommand.Execute(model.Users[0]);
        var editor = model.UserEditor;
        Assert.NotNull(editor);
        Assert.Equal("Изменить пользователя", editor.TitleText);
        Assert.Equal("Пётр Петров", editor.FullName);
        Assert.True(editor.CanEditPrivileged);

        editor.FullName = "Пётр Сидоров";
        Assert.True(await editor.SubmitAsync(null));

        var (userId, request) = Assert.Single(api.UpdateUserCalls);
        Assert.Equal(42, userId);
        Assert.Equal("Пётр Сидоров", request.FullName);
        // exclude_unset-семантика: неизменённые поля в PATCH не уходят.
        Assert.Null(request.Email);
        Assert.Null(request.Department);
        Assert.Null(request.JobTitle);
        Assert.Null(request.Role);
        Assert.Null(request.IsActive);
        Assert.Null(request.Password);
        // Строка обновилась из ответа User и диалог закрылся.
        Assert.Null(model.UserEditor);
        Assert.Equal("Пётр Сидоров", model.Users[0].Title);
    }

    [Fact]
    public async Task EditUserNoChangesSkipsApiCall()
    {
        var api = new FakeHubApiClient { CurrentUser = AdminUser, AdminUsers = [TargetUser] };
        var model = new AdminViewModel(api);
        await model.LoadAsync();
        model.EditUserCommand.Execute(model.Users[0]);
        var editor = model.UserEditor!;

        Assert.False(await editor.SubmitAsync(null));
        Assert.Empty(api.UpdateUserCalls);
        Assert.Equal("Изменений нет.", editor.StatusText);
    }

    [Fact]
    public async Task EditUserServerErrorShowsTextKeepsDialog()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = AdminUser,
            AdminUsers = [TargetUser],
            UpdateUserException = new HubApiException(
                HubApiErrorKind.Http, "Cannot deactivate current admin user", HttpStatusCode.BadRequest),
        };
        var model = new AdminViewModel(api);
        await model.LoadAsync();
        model.EditUserCommand.Execute(model.Users[0]);
        var editor = model.UserEditor!;
        editor.IsActive = false;

        Assert.False(await editor.SubmitAsync(null));
        // Диалог остаётся открытым, detail сервера виден в ошибке.
        Assert.NotNull(model.UserEditor);
        Assert.True(editor.HasError);
        Assert.Contains("Cannot deactivate", editor.ErrorText);
    }

    [Fact]
    public async Task DeactivateUserSendsIsActiveFalse()
    {
        var api = new FakeHubApiClient { CurrentUser = AdminUser, AdminUsers = [TargetUser] };
        var model = new AdminViewModel(api);
        await model.LoadAsync();
        model.EditUserCommand.Execute(model.Users[0]);
        var editor = model.UserEditor!;
        editor.IsActive = false;

        Assert.True(await editor.SubmitAsync(null));
        var (_, request) = Assert.Single(api.UpdateUserCalls);
        Assert.False(request.IsActive!.Value);
        Assert.False(model.Users[0].Source.IsActive);
        Assert.Equal("Отключён", model.Users[0].StatusText);
    }

    [Fact]
    public async Task CreateUserAddsRowAndClosesDialog()
    {
        var api = new FakeHubApiClient { CurrentUser = AdminUser, AdminUsers = [] };
        var model = new AdminViewModel(api);
        await model.LoadAsync();

        Assert.True(model.CanCreateUsers);
        model.CreateUserCommand.Execute(null);
        var editor = model.UserEditor;
        Assert.NotNull(editor);
        Assert.True(editor.IsCreateMode);
        Assert.True(editor.IsUsernameVisible);

        editor.Username = "novikov";
        editor.FullName = "Новиков Дмитрий";

        // Короткий пароль — локальная валидация без запроса.
        Assert.False(await editor.SubmitAsync("123"));
        Assert.True(editor.HasError);
        Assert.Empty(api.CreateUserCalls);

        Assert.True(await editor.SubmitAsync("secret123"));
        var request = Assert.Single(api.CreateUserCalls);
        Assert.Equal("novikov", request.Username);
        Assert.Equal("secret123", request.Password);
        Assert.Equal("viewer", request.Role);
        Assert.True(request.IsActive);
        Assert.Null(model.UserEditor);
        var row = Assert.Single(model.Users);
        Assert.Equal("Новиков Дмитрий", row.Title);
        Assert.Equal("1 пользователь", model.TotalText);
    }

    [Fact]
    public async Task CreateUserServerErrorShowsInDialog()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = AdminUser,
            AdminUsers = [],
            CreateUserException = new HubApiException(
                HubApiErrorKind.Http, "Username already exists", HttpStatusCode.BadRequest),
        };
        var model = new AdminViewModel(api);
        await model.LoadAsync();
        model.CreateUserCommand.Execute(null);
        var editor = model.UserEditor!;
        editor.Username = "admin";

        Assert.False(await editor.SubmitAsync("secret123"));
        Assert.NotNull(model.UserEditor);
        Assert.Contains("Username already exists", editor.ErrorText);
    }

    [Fact]
    public async Task ResetTwoFactorNeedsDoublePress()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = AdminUser,
            AdminUsers = [TargetUser],
            ResetTwoFactorResult = new HubResetTwoFactorResult { Success = true, RevokedDevices = 3 },
        };
        var model = new AdminViewModel(api);
        await model.LoadAsync();
        model.EditUserCommand.Execute(model.Users[0]);
        var editor = model.UserEditor!;
        Assert.True(editor.IsResetAvailable);
        Assert.Equal("Сбросить 2FA", editor.ResetTwoFactorText);

        // Первое нажатие — только подтверждение (armed), запроса нет.
        await ((NativeAsyncCommand)editor.ResetTwoFactorCommand).ExecuteAsync(null);
        Assert.Empty(api.ResetTwoFactorCalls);
        Assert.Contains("ещё раз", editor.ResetTwoFactorText);

        // Второе — реальный сброс.
        await ((NativeAsyncCommand)editor.ResetTwoFactorCommand).ExecuteAsync(null);
        Assert.Equal([42L], api.ResetTwoFactorCalls);
        Assert.Contains("сброшена", editor.StatusText);
        Assert.False(editor.IsResetAvailable);
    }

    [Fact]
    public async Task NonAdminEditorShowsOnlyDelegatedFields()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = new HubUser
            {
                Id = 5,
                Username = "manager",
                Role = "operator",
                Permissions = ["settings.users.manage"],
            },
            AdminUsers = [TargetUser],
        };
        var model = new AdminViewModel(api);
        await model.LoadAsync();
        Assert.False(model.IsAdminRole);
        Assert.False(model.CanCreateUsers);

        model.EditUserCommand.Execute(model.Users[0]);
        var editor = model.UserEditor;
        Assert.NotNull(editor);
        Assert.False(editor.CanEditPrivileged);
        Assert.False(editor.IsResetAvailable);
        Assert.False(editor.IsPasswordVisible);
        Assert.False(editor.IsUsernameVisible);

        // Привилегированные поля не собираются в PATCH даже при прямой установке.
        editor.SelectedRole = "admin";
        editor.IsActive = false;
        editor.FullName = "Новое Имя";
        Assert.True(await editor.SubmitAsync(null));

        var (_, request) = Assert.Single(api.UpdateUserCalls);
        Assert.Equal("Новое Имя", request.FullName);
        Assert.Null(request.Role);
        Assert.Null(request.IsActive);
        Assert.Null(request.Password);
    }

    [Fact]
    public async Task NonAdminCannotEditAdminTarget()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = new HubUser
            {
                Id = 5,
                Username = "manager",
                Role = "operator",
                Permissions = ["settings.users.manage"],
            },
            AdminUsers =
            [
                TargetUser,
                new HubAdminUser { Id = 1, Username = "root", Role = "admin", FullName = "Root" },
            ],
        };
        var model = new AdminViewModel(api);
        await model.LoadAsync();

        // Кнопка «Изменить» есть только у не-admin целей (сервер отклонил бы 403).
        Assert.True(model.Users.First(u => u.Id == 42).CanEdit);
        Assert.False(model.Users.First(u => u.Id == 1).CanEdit);
    }

    [Fact]
    public async Task SelfEditDisablesRoleAndActive()
    {
        var self = new HubAdminUser
        {
            Id = 1,
            Username = "root",
            FullName = "Root Admin",
            Role = "admin",
            IsActive = true,
        };
        var api = new FakeHubApiClient { CurrentUser = AdminUser, AdminUsers = [self] };
        var model = new AdminViewModel(api);
        await model.LoadAsync();
        model.EditUserCommand.Execute(model.Users[0]);
        var editor = model.UserEditor!;

        Assert.True(editor.IsSelf);
        Assert.False(editor.ArePrivilegedInputsEnabled);
        Assert.True(editor.HasSelfHint);

        // Даже при прямой установке self-edit исключает role/is_active из diff.
        editor.SelectedRole = "viewer";
        editor.IsActive = false;
        var (request, hasChanges) = editor.BuildUpdateRequest();
        Assert.Null(request.Role);
        Assert.Null(request.IsActive);
        Assert.False(hasChanges);
    }

    // ---- AI-боты: write-флоу ----

    private static HubAdminAiBot TargetBot => new()
    {
        Id = "b1",
        Slug = "corp-assistant",
        Title = "Ассистент HUB",
        Description = "Отвечает по базе знаний",
        SystemPrompt = "Будь краток",
        Model = "openrouter/model",
        Temperature = 0.2,
        MaxTokens = 2000,
        AllowedKbScope = ["it"],
        AllowFileInput = true,
        AllowGeneratedArtifacts = true,
        AllowKbDocumentDelivery = false,
        IsEnabled = true,
        Configured = true,
    };

    [Fact]
    public async Task EditAiBotPatchesOnlyChangedFieldsAndUpdatesRow()
    {
        var api = new FakeHubApiClient { CurrentUser = AdminUser, AdminAiBots = [TargetBot] };
        var model = new AdminViewModel(api);
        await model.LoadAsync();
        var section = model.Sections.First(s => s.Key == "ai-bots");
        await ((NativeAsyncCommand)model.SelectSectionCommand).ExecuteAsync(section);

        var row = Assert.Single(model.AiBots);
        Assert.True(row.CanEdit);
        Assert.True(model.CanManageAiBots);

        model.EditAiBotCommand.Execute(row);
        var editor = model.AiBotEditor;
        Assert.NotNull(editor);
        Assert.Equal("Изменить AI-бота", editor.TitleText);
        Assert.Equal("Ассистент HUB", editor.Title);
        Assert.False(editor.IsCreateMode);
        Assert.False(editor.IsSlugVisible);
        Assert.False(editor.IsSandboxMode);

        editor.Title = "Ассистент 2.0";
        editor.IsEnabled = false;
        Assert.True(await editor.SubmitAsync());

        var (botId, request) = Assert.Single(api.UpdateAiBotCalls);
        Assert.Equal("b1", botId);
        Assert.Equal("Ассистент 2.0", request.Title);
        Assert.False(request.IsEnabled!.Value);
        // exclude_unset-семантика: неизменённые поля в PATCH не уходят.
        Assert.Null(request.Description);
        Assert.Null(request.SystemPrompt);
        Assert.Null(request.Model);
        Assert.Null(request.Temperature);
        Assert.Null(request.MaxTokens);
        Assert.Null(request.AllowedKbScope);
        Assert.Null(request.AllowFileInput);
        // Строка обновилась из ответа и диалог закрылся.
        Assert.Null(model.AiBotEditor);
        Assert.Equal("Ассистент 2.0", model.AiBots[0].Title);
        Assert.Equal("Выключен", model.AiBots[0].StatusText);
    }

    [Fact]
    public async Task EditAiBotNoChangesSkipsApiCall()
    {
        var api = new FakeHubApiClient { CurrentUser = AdminUser, AdminAiBots = [TargetBot] };
        var model = new AdminViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.SelectSectionCommand)
            .ExecuteAsync(model.Sections.First(s => s.Key == "ai-bots"));
        model.EditAiBotCommand.Execute(model.AiBots[0]);
        var editor = model.AiBotEditor!;

        Assert.False(await editor.SubmitAsync());
        Assert.Empty(api.UpdateAiBotCalls);
        Assert.Equal("Изменений нет.", editor.StatusText);
    }

    [Fact]
    public async Task EditAiBotSandboxPatchesOnlyTitleAndDescription()
    {
        var sandbox = TargetBot with { Id = "b2", Slug = "opencode", Surface = "sandbox" };
        var api = new FakeHubApiClient { CurrentUser = AdminUser, AdminAiBots = [sandbox] };
        var model = new AdminViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.SelectSectionCommand)
            .ExecuteAsync(model.Sections.First(s => s.Key == "ai-bots"));
        model.EditAiBotCommand.Execute(model.AiBots[0]);
        var editor = model.AiBotEditor!;

        Assert.True(editor.IsSandboxMode);
        Assert.False(editor.AreMainFieldsVisible);
        Assert.Contains("OpenCode", editor.SandboxHintText);

        // Полей «Настройки ответа» у sandbox нет: прямая установка всё равно
        // не попадает в PATCH — только title/description, как в вебе.
        editor.Model = "other/model";
        editor.IsEnabled = false;
        editor.Description = "Новое описание";
        Assert.True(await editor.SubmitAsync());

        var (_, request) = Assert.Single(api.UpdateAiBotCalls);
        Assert.Equal("Новое описание", request.Description);
        Assert.Null(request.Model);
        Assert.Null(request.IsEnabled);
        Assert.Null(request.Title);
    }

    [Fact]
    public async Task EditAiBotServerErrorShowsTextKeepsDialog()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = AdminUser,
            AdminAiBots = [TargetBot],
            UpdateAiBotException = new HubApiException(
                HubApiErrorKind.Http, "AI bot not found", HttpStatusCode.NotFound),
        };
        var model = new AdminViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.SelectSectionCommand)
            .ExecuteAsync(model.Sections.First(s => s.Key == "ai-bots"));
        model.EditAiBotCommand.Execute(model.AiBots[0]);
        var editor = model.AiBotEditor!;
        editor.Title = "Другое имя";

        Assert.False(await editor.SubmitAsync());
        Assert.NotNull(model.AiBotEditor);
        Assert.True(editor.HasError);
        Assert.Contains("AI bot not found", editor.ErrorText);
    }

    [Fact]
    public async Task EditAiBotInvalidNumbersBlockRequest()
    {
        var api = new FakeHubApiClient { CurrentUser = AdminUser, AdminAiBots = [TargetBot] };
        var model = new AdminViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.SelectSectionCommand)
            .ExecuteAsync(model.Sections.First(s => s.Key == "ai-bots"));
        model.EditAiBotCommand.Execute(model.AiBots[0]);
        var editor = model.AiBotEditor!;

        editor.TemperatureText = "9";
        Assert.False(await editor.SubmitAsync());
        Assert.Contains("от 0 до 2", editor.ErrorText);
        Assert.Empty(api.UpdateAiBotCalls);

        editor.TemperatureText = "0,7"; // запятая — допустимый разделитель
        editor.MaxTokensText = "100";
        Assert.False(await editor.SubmitAsync());
        Assert.Contains("от 256 до 16000", editor.ErrorText);
        Assert.Empty(api.UpdateAiBotCalls);
    }

    [Fact]
    public async Task CreateAiBotAddsRowAndClosesDialog()
    {
        var api = new FakeHubApiClient { CurrentUser = AdminUser, AdminAiBots = [] };
        var model = new AdminViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.SelectSectionCommand)
            .ExecuteAsync(model.Sections.First(s => s.Key == "ai-bots"));

        model.CreateAiBotCommand.Execute(null);
        var editor = model.AiBotEditor;
        Assert.NotNull(editor);
        Assert.True(editor.IsCreateMode);
        Assert.True(editor.IsSlugVisible);
        Assert.Equal("Новый AI-бот", editor.TitleText);

        // Пустой slug/title — локальная валидация без запроса.
        editor.Slug = "x";
        Assert.False(await editor.SubmitAsync());
        Assert.Empty(api.CreateAiBotCalls);

        editor.Slug = "Support-Bot";
        editor.Title = "Саппорт";
        Assert.True(await editor.SubmitAsync());

        var request = Assert.Single(api.CreateAiBotCalls);
        // slug нормализуется в нижний регистр (field_validator бэкенда).
        Assert.Equal("support-bot", request.Slug);
        Assert.Equal("Саппорт", request.Title);
        Assert.Equal(0.2, request.Temperature);
        Assert.Equal(2000, request.MaxTokens);
        Assert.True(request.IsEnabled);
        Assert.Null(model.AiBotEditor);
        var row = Assert.Single(model.AiBots);
        Assert.Equal("Саппорт", row.Title);
        Assert.Equal("1 AI-бот", model.TotalText);
    }

    [Fact]
    public async Task CreateAiBotServerErrorShowsInDialog()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = AdminUser,
            AdminAiBots = [],
            CreateAiBotException = new HubApiException(
                HubApiErrorKind.Http, "Slug already exists", HttpStatusCode.BadRequest),
        };
        var model = new AdminViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.SelectSectionCommand)
            .ExecuteAsync(model.Sections.First(s => s.Key == "ai-bots"));
        model.CreateAiBotCommand.Execute(null);
        var editor = model.AiBotEditor!;

        Assert.False(await editor.SubmitAsync());
        Assert.NotNull(model.AiBotEditor);
        Assert.Contains("Slug already exists", editor.ErrorText);
        // Черновик не потерян: введённые значения остались в диалоге.
        Assert.Equal("new-ai-bot", editor.Slug);
    }

    [Fact]
    public async Task AiBotRowsHaveNoEditButtonWithoutManageRight()
    {
        // Раздел ai-bots целиком гейтится settings.ai.manage — без права
        // раздела нет, кнопок «Изменить» тоже (сервер отклонил бы 403).
        var api = new FakeHubApiClient
        {
            CurrentUser = new HubUser
            {
                Id = 6,
                Username = "reader",
                Role = "operator",
                Permissions = ["feedback.manage"],
            },
            AdminAiBots = [TargetBot],
        };
        var model = new AdminViewModel(api);
        await model.LoadAsync();

        Assert.DoesNotContain(model.Sections, s => s.Key == "ai-bots");
        Assert.False(model.CanManageAiBots);
        Assert.False(model.CreateAiBotCommand.CanExecute(null));
    }

    // ---- Отделы: руководители ----

    private static FakeHubApiClient DepartmentApi() => new()
    {
        CurrentUser = AdminUser,
        AdminDepartments = new HubAdminDepartmentList
        {
            Items =
            [
                new HubAdminDepartment
                {
                    Id = "d1", Name = "ИТ", MembersCount = 2, ManagersCount = 1,
                },
            ],
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
                    UserId = 2, Role = "member",
                    User = new HubAdminDepartmentMemberUser { Username = "worker", FullName = "Рабочий" },
                },
            ],
        },
    };

    private static async Task<AdminViewModel> LoadDepartmentsAsync(FakeHubApiClient api)
    {
        var model = new AdminViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.SelectSectionCommand)
            .ExecuteAsync(model.Sections.First(s => s.Key == "departments"));
        model.SelectedDepartment = model.Departments[0];
        await WaitFor(() => model.DepartmentMembers.Count > 0);
        return model;
    }

    [Fact]
    public async Task DepartmentManagersPutsFullIdSetAndRebuildsMembers()
    {
        var api = DepartmentApi();
        var model = await LoadDepartmentsAsync(api);
        Assert.True(model.CanManageDepartments);
        Assert.Equal("2 участ. · 1 нач.", model.Departments[0].MembersText);

        model.EditDepartmentManagersCommand.Execute(null);
        var editor = model.DepartmentManagersEditor;
        Assert.NotNull(editor);
        Assert.Equal("Руководители отдела", editor.TitleText);
        Assert.Equal(2, editor.Rows.Count);
        Assert.True(editor.Rows.First(r => r.UserId == 1).IsManager);
        Assert.False(editor.Rows.First(r => r.UserId == 2).IsManager);
        Assert.Equal("Начальников: 1", editor.CountText);

        // Добавляем второго начальника — живой счётчик + PUT полным набором.
        editor.Rows.First(r => r.UserId == 2).IsManager = true;
        Assert.Equal("Начальников: 2", editor.CountText);
        Assert.True(await editor.SubmitAsync());

        var (departmentId, ids) = Assert.Single(api.SetDepartmentManagersCalls);
        Assert.Equal("d1", departmentId);
        Assert.Equal([1L, 2L], ids.Order().ToArray());
        Assert.Null(model.DepartmentManagersEditor);
        // Состав пересобран из ответа: у обоих — роль начальника.
        Assert.All(model.DepartmentMembers, m => Assert.Contains("начальник", m.RolesText));
        // Счётчик «M нач.» у строки отдела обновлён без перезагрузки списка.
        Assert.Equal("2 участ. · 2 нач.", model.Departments[0].MembersText);
    }

    [Fact]
    public async Task DepartmentManagersUncheckAllRemovesManagers()
    {
        var api = DepartmentApi();
        var model = await LoadDepartmentsAsync(api);
        model.EditDepartmentManagersCommand.Execute(null);
        var editor = model.DepartmentManagersEditor!;

        // Снятие единственного начальника → PUT с пустым набором.
        editor.Rows.First(r => r.UserId == 1).IsManager = false;
        Assert.True(await editor.SubmitAsync());

        var (_, ids) = Assert.Single(api.SetDepartmentManagersCalls);
        Assert.Empty(ids);
        Assert.Equal("2 участ. · 0 нач.", model.Departments[0].MembersText);
    }

    [Fact]
    public async Task DepartmentManagersNoChangesSkipsApiCall()
    {
        var api = DepartmentApi();
        var model = await LoadDepartmentsAsync(api);
        model.EditDepartmentManagersCommand.Execute(null);
        var editor = model.DepartmentManagersEditor!;

        Assert.False(await editor.SubmitAsync());
        Assert.Empty(api.SetDepartmentManagersCalls);
        Assert.Equal("Изменений нет.", editor.StatusText);
    }

    [Fact]
    public async Task DepartmentManagersServerErrorKeepsDialog()
    {
        var api = DepartmentApi();
        api.SetDepartmentManagersException = new HubApiException(
            HubApiErrorKind.Http, "forbidden", HttpStatusCode.Forbidden);
        var model = await LoadDepartmentsAsync(api);
        model.EditDepartmentManagersCommand.Execute(null);
        var editor = model.DepartmentManagersEditor!;
        editor.Rows.First(r => r.UserId == 2).IsManager = true;

        Assert.False(await editor.SubmitAsync());
        Assert.NotNull(model.DepartmentManagersEditor);
        Assert.True(editor.HasError);
        Assert.Contains("Недостаточно прав", editor.ErrorText);
        // Отметка не потеряна — можно поправить и повторить.
        Assert.True(editor.Rows.First(r => r.UserId == 2).IsManager);
    }

    // ---- Почтовые квоты ----

    private static FakeHubApiClient MailQuotaApi(int rowCount = 3) => new()
    {
        CurrentUser = AdminUser,
        MailQuotaLatest = new HubMailQuotaSnapshot
        {
            Id = 7,
            ImportedAt = "2026-11-19T09:00:00+03:00",
            CollectedAt = "2026-11-19T08:55:00+03:00",
            SourceHost = "exch-01",
            ExchangeServer = "EXCH-01",
            RowCount = 3,
        },
        MailQuotaSnapshots =
        [
            new HubMailQuotaSnapshot
            {
                Id = 7, ImportedAt = "2026-11-19T09:00:00+03:00", SourceHost = "exch-01", RowCount = 3,
            },
            new HubMailQuotaSnapshot
            {
                Id = 6, ImportedAt = "2026-11-18T09:00:00+03:00", SourceHost = "exch-01", RowCount = 2,
            },
        ],
        MailQuotaSummary = new HubMailQuotaSnapshotStats
        {
            SnapshotId = 7,
            Total = 3,
            WithQuota = 2,
            NoQuota = 1,
            OverQuota = 1,
            Warning90 = 1,
            ByDatabase = [new HubMailQuotaDatabaseSummary { Name = "DB1", Total = 3, OverQuota = 1 }],
        },
        MailQuotaRowsPage = new HubMailQuotaRowsPage
        {
            Total = rowCount,
            Items =
            [
                new HubMailQuotaRow
                {
                    Id = 1, Email = "full@zsgp.ru", DisplayName = "Полный Ящик",
                    UsedBytes = 6L * 1024 * 1024 * 1024, QuotaBytes = 5L * 1024 * 1024 * 1024,
                    FreeBytes = 0, UsedPercent = 120, DatabaseName = "DB1",
                },
                new HubMailQuotaRow
                {
                    Id = 2, Email = "edge@zsgp.ru", DisplayName = "Почти Полный",
                    UsedBytes = 4L * 1024 * 1024 * 1024 + 612L * 1024 * 1024,
                    QuotaBytes = 5L * 1024 * 1024 * 1024, UsedPercent = 92.2, DatabaseName = "DB1",
                },
                new HubMailQuotaRow
                {
                    Id = 3, Email = "plain@zsgp.ru",
                    UsedBytes = 1024L * 1024 * 1024, QuotaBytes = 5L * 1024 * 1024 * 1024,
                    UsesDefaultQuota = true, DatabaseName = "DB2",
                },
            ],
        },
    };

    private static async Task<AdminViewModel> LoadMailQuotasAsync(FakeHubApiClient api)
    {
        var model = new AdminViewModel(api) { DelayAsync = (_, _) => Task.CompletedTask };
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.SelectSectionCommand)
            .ExecuteAsync(model.Sections.First(s => s.Key == "mail-quotas"));
        return model;
    }

    [Fact]
    public async Task MailQuotasSectionLoadsSnapshotStatsAndRows()
    {
        var api = MailQuotaApi();
        var model = await LoadMailQuotasAsync(api);

        Assert.True(model.IsMailQuotasSection);
        Assert.True(model.IsMailQuotaContentVisible);
        Assert.Equal(1, api.MailQuotaLatestCallCount);
        Assert.Equal(20, api.LastMailQuotaSnapshotsLimit);
        Assert.Equal([7], api.MailQuotaSummaryCalls);
        // Строки — первая страница выбранного снимка без фильтров.
        var (snapshotId, query) = Assert.Single(api.MailQuotaRowsCalls);
        Assert.Equal(7, snapshotId);
        Assert.Equal(0, query.Offset);
        Assert.Equal(100, query.Limit);
        Assert.False(query.OverQuota || query.Warning90 || query.NoQuota);

        Assert.Equal(3, model.MailQuotaRows.Count);
        Assert.Equal(2, model.MailQuotaSnapshots.Count);
        Assert.Equal(7, model.SelectedMailQuotaSnapshot?.Id);
        Assert.Equal(2, model.MailQuotaDatabaseOptions.Count);
        Assert.Contains("Снимок #7", model.QuotaSnapshotInfoText);
        Assert.Contains("exch-01", model.QuotaSnapshotInfoText);
        // Пилюли сводки: Всего / ≥90% / Превышены / Без квоты с тонами.
        Assert.Equal(
            ["Всего: 3", "≥ 90%: 1", "Превышены: 1", "Без квоты: 1"],
            model.MailQuotaStats.Select(s => s.Text).ToArray());
        Assert.Equal("error", model.MailQuotaStats[2].StatusTone);
        Assert.Equal("warning", model.MailQuotaStats[1].StatusTone);
        // Маппинг строк: статусы и тоны как resolveQuotaStatus веба.
        Assert.Equal("Переполнен", model.MailQuotaRows[0].StatusText);
        Assert.Equal("error", model.MailQuotaRows[0].StatusTone);
        Assert.Equal("90–100%", model.MailQuotaRows[1].StatusText);
        Assert.Equal("warning", model.MailQuotaRows[1].StatusTone);
        Assert.Equal("Норма", model.MailQuotaRows[2].StatusText);
        Assert.Equal("success", model.MailQuotaRows[2].StatusTone);
        Assert.Equal("20%", model.MailQuotaRows[2].PercentText);
        Assert.Contains("по умолч.", model.MailQuotaRows[2].QuotaText);
        Assert.Equal("3 ящика", model.TotalText);
    }

    [Fact]
    public async Task MailQuotaSectionGatedByQuotaReadPermission()
    {
        // Не-admin с mail.quotas.read видит только этот раздел.
        var api = MailQuotaApi();
        api.CurrentUser = new HubUser
        {
            Id = 8, Username = "reader", Role = "viewer", Permissions = ["mail.quotas.read"],
        };
        var model = new AdminViewModel(api);
        await model.LoadAsync();

        Assert.Equal(["mail-quotas"], model.Sections.Select(s => s.Key).ToArray());
        Assert.True(model.IsMailQuotasSection);
        Assert.Equal(1, api.MailQuotaLatestCallCount);

        // Без права раздела нет даже при других admin-правилах.
        var api2 = new FakeHubApiClient
        {
            CurrentUser = new HubUser
            {
                Id = 9, Username = "fb", Role = "operator", Permissions = ["feedback.manage"],
            },
        };
        var model2 = new AdminViewModel(api2);
        await model2.LoadAsync();
        Assert.DoesNotContain(model2.Sections, s => s.Key == "mail-quotas");
    }

    [Fact]
    public async Task MailQuotaLatest404FallsBackToSnapshotsList()
    {
        var api = MailQuotaApi();
        api.MailQuotaLatest = null; // 404 — latest-эндпоинт отвечает как сервер без снимков.
        var model = await LoadMailQuotasAsync(api);

        // Селектор из list-ответа: первый снимок подхвачен, раздел не упал.
        Assert.True(model.HasQuotaSnapshot);
        Assert.Equal(7, model.SelectedMailQuotaSnapshot?.Id);
        Assert.Equal(3, model.MailQuotaRows.Count);
        Assert.False(model.HasBannerError);
    }

    [Fact]
    public async Task MailQuotaNoSnapshotsShowsEmptyState()
    {
        var api = MailQuotaApi();
        api.MailQuotaLatest = null;
        api.MailQuotaSnapshots = [];
        var model = await LoadMailQuotasAsync(api);

        Assert.False(model.HasQuotaSnapshot);
        Assert.False(model.IsMailQuotaContentVisible);
        Assert.Empty(model.MailQuotaRows);
        Assert.True(model.IsEmpty);
        Assert.Equal("Снимков квот пока нет — дождитесь импорта", model.EmptyText);
        Assert.False(model.HasBannerError);
        // Без снимка summary/rows не запрашиваются.
        Assert.Empty(api.MailQuotaSummaryCalls);
        Assert.Empty(api.MailQuotaRowsCalls);
    }

    [Fact]
    public async Task MailQuotaChipsMapToRowsQueryFlags()
    {
        var api = MailQuotaApi();
        var model = await LoadMailQuotasAsync(api);
        api.MailQuotaRowsCalls.Clear();

        model.MailQuotaChips.First(c => c.Value == "over_quota").IsChecked = true;
        await WaitFor(() => api.MailQuotaRowsCalls.Count == 1);
        Assert.True(api.MailQuotaRowsCalls[0].Query.OverQuota);
        Assert.False(api.MailQuotaRowsCalls[0].Query.Warning90);
        Assert.False(api.MailQuotaRowsCalls[0].Query.NoQuota);

        model.MailQuotaChips.First(c => c.Value == "no_quota").IsChecked = true;
        await WaitFor(() => api.MailQuotaRowsCalls.Count == 2);
        Assert.True(api.MailQuotaRowsCalls[1].Query.NoQuota);
        Assert.False(api.MailQuotaRowsCalls[1].Query.OverQuota);

        // «Все» — ни одного флага.
        model.MailQuotaChips.First(c => c.Value == "").IsChecked = true;
        await WaitFor(() => api.MailQuotaRowsCalls.Count == 3);
        Assert.False(api.MailQuotaRowsCalls[2].Query.OverQuota
            || api.MailQuotaRowsCalls[2].Query.Warning90
            || api.MailQuotaRowsCalls[2].Query.NoQuota);
        Assert.Equal("", model.SelectedQuotaFilter);
    }

    [Fact]
    public async Task MailQuotaSearchAndDatabaseFilterGoToRowsQuery()
    {
        var api = MailQuotaApi();
        var model = await LoadMailQuotasAsync(api);
        api.MailQuotaRowsCalls.Clear();

        model.SearchText = "  full@  ";
        await WaitFor(() => api.MailQuotaRowsCalls.Count == 1);
        Assert.Equal("full@", api.MailQuotaRowsCalls[0].Query.Search);
        Assert.Equal(0, api.MailQuotaRowsCalls[0].Query.Offset);

        model.SelectedMailQuotaDatabase = model.MailQuotaDatabaseOptions.First(o => o.Value == "DB1");
        await WaitFor(() => api.MailQuotaRowsCalls.Count == 2);
        Assert.Equal("DB1", api.MailQuotaRowsCalls[1].Query.DatabaseName);
        Assert.Equal("full@", api.MailQuotaRowsCalls[1].Query.Search);
        Assert.True(model.HasQuotaFilters);
    }

    [Fact]
    public async Task MailQuotaLoadMoreAppendsNextPage()
    {
        var api = MailQuotaApi(rowCount: 150);
        // Первая страница — 100 строк, вторая — остаток 50; total=150.
        api.MailQuotaRowsResponder = (_, query) => new HubMailQuotaRowsPage
        {
            Total = 150,
            Items = Enumerable.Range(0, query.Offset == 0 ? 100 : 50)
                .Select(i => new HubMailQuotaRow
                {
                    Id = query.Offset + i,
                    Email = $"u{query.Offset + i}@zsgp.ru",
                    QuotaBytes = 5L * 1024 * 1024 * 1024,
                    UsedPercent = 10,
                })
                .ToList(),
        };
        var model = await LoadMailQuotasAsync(api);

        Assert.Equal(100, model.MailQuotaRows.Count);
        Assert.True(model.QuotaHasMore);
        Assert.Equal("Показано 100 из 150", model.TotalText);
        Assert.Contains("50", model.QuotaMoreButtonText);

        await ((NativeAsyncCommand)model.LoadMoreMailQuotaRowsCommand).ExecuteAsync(null);

        Assert.Equal(150, model.MailQuotaRows.Count);
        Assert.False(model.QuotaHasMore);
        Assert.Equal("150 ящиков", model.TotalText);
        var last = api.MailQuotaRowsCalls.Last();
        Assert.Equal(100, last.Query.Offset);
    }

    [Fact]
    public async Task MailQuotaSnapshotSelectorReloadsSummaryAndRows()
    {
        var api = MailQuotaApi();
        var model = await LoadMailQuotasAsync(api);
        api.MailQuotaRowsCalls.Clear();
        api.MailQuotaSummaryCalls.Clear();

        model.SelectedMailQuotaSnapshot = model.MailQuotaSnapshots.First(s => s.Id == 6);
        await WaitFor(() => api.MailQuotaRowsCalls.Count == 1);

        Assert.Equal([6], api.MailQuotaSummaryCalls);
        Assert.Equal(6, api.MailQuotaRowsCalls[0].SnapshotId);
        Assert.Equal(0, api.MailQuotaRowsCalls[0].Query.Offset);
        Assert.Contains("Снимок #6", model.QuotaSnapshotInfoText);
    }

    [Fact]
    public async Task MailQuotaRowsErrorGoesToBanner()
    {
        var api = MailQuotaApi();
        var model = await LoadMailQuotasAsync(api);

        api.MailQuotaRowsException = new HubApiException(HubApiErrorKind.Transport, "down");
        model.MailQuotaChips.First(c => c.Value == "over_quota").IsChecked = true;
        await WaitFor(() => api.MailQuotaRowsCalls.Count == 2);

        Assert.True(model.HasBannerError);
        Assert.Contains("соединения", model.BannerErrorText, StringComparison.OrdinalIgnoreCase);
        api.MailQuotaRowsException = null;
    }

    [Fact]
    public async Task MailQuotaSection403ShowsDeniedHint()
    {
        var api = MailQuotaApi();
        api.MailQuotaLatestException = new HubApiException(
            HubApiErrorKind.Http, "Insufficient permissions: mail.quotas.read", HttpStatusCode.Forbidden);
        var model = new AdminViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.SelectSectionCommand)
            .ExecuteAsync(model.Sections.First(s => s.Key == "mail-quotas"));

        Assert.True(model.HasSectionDenied);
        Assert.Contains("Недостаточно прав", model.SectionDeniedText);
        Assert.False(model.HasBannerError);
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

    // ---- Новости ----

    private static HubUser NewsWriter => new()
    {
        Id = 5,
        Username = "writer",
        Role = "operator",
        Permissions = ["announcements.write"],
    };

    private static FakeHubApiClient NewsApi(HubUser? user = null) => new()
    {
        CurrentUser = user ?? NewsWriter,
        ManagedAnnouncementsItems =
        [
            new HubAnnouncementItem
            {
                Id = "n-1", Title = "Черновик один", Status = "draft",
                Priority = "normal", AuthorFullName = "Автор Один",
                RequiresAck = true, CanManage = true,
                Category = new HubAnnouncementCategory { Id = "1", Name = "ИТ" },
                Tags = [new HubAnnouncementTag { Name = "релиз" }],
            },
            new HubAnnouncementItem
            {
                Id = "n-2", Title = "Опубликованная новость", Status = "published",
                AuthorUsername = "editor", CanManage = true,
            },
            // Чужой черновик без can_manage: writer его не правит и не публикует.
            new HubAnnouncementItem
            {
                Id = "n-3", Title = "Бетонные работы", Status = "draft",
                AuthorFullName = "Внешний Автор", CanManage = false,
            },
        ],
        AnnouncementCategories = new HubAnnouncementCategoryList
        {
            Items = [new HubAnnouncementCategory { Id = "1", Name = "ИТ" }],
        },
        AnnouncementTags = new HubAnnouncementTagList
        {
            Items = [new HubAnnouncementTag { Id = "7", Name = "релиз" }],
        },
    };

    private static async Task<AdminViewModel> LoadNewsAsync(FakeHubApiClient api)
    {
        var model = new AdminViewModel(api);
        await model.LoadAsync();
        var news = model.Sections.First(s => s.Key == "news");
        if (!ReferenceEquals(model.SelectedSection, news))
        {
            await ((NativeAsyncCommand)model.SelectSectionCommand).ExecuteAsync(news);
        }

        return model;
    }

    [Fact]
    public async Task NewsSectionVisibleForWriteAndModerateOnly()
    {
        var writer = new AdminViewModel(NewsApi());
        await writer.LoadAsync();

        // announcements.write: раздел есть, «+ Новость» доступна.
        Assert.Equal(["news"], writer.Sections.Select(s => s.Key).ToArray());
        Assert.True(writer.CanCreateNews);
        Assert.True(writer.CreateNewsCommand.CanExecute(null));

        var moderatorApi = NewsApi(user: new HubUser
        {
            Id = 6,
            Username = "mod",
            Role = "operator",
            Permissions = ["announcements.moderate"],
        });
        var moderator = new AdminViewModel(moderatorApi);
        await moderator.LoadAsync();

        // announcements.moderate: раздел есть, но create — строго write.
        Assert.Equal(["news"], moderator.Sections.Select(s => s.Key).ToArray());
        Assert.False(moderator.CanCreateNews);
        Assert.False(moderator.CreateNewsCommand.CanExecute(null));

        // announcements.read без write|moderate — раздела нет вовсе.
        var readerApi = new FakeHubApiClient
        {
            CurrentUser = new HubUser
            {
                Id = 7,
                Username = "reader",
                Role = "operator",
                Permissions = ["announcements.read", "feedback.manage"],
            },
        };
        var reader = new AdminViewModel(readerApi);
        await reader.LoadAsync();
        Assert.DoesNotContain(reader.Sections, s => s.Key == "news");
        Assert.Empty(readerApi.ManagedAnnouncementsCalls);
    }

    [Fact]
    public async Task NewsSectionLoadsDraftsByDefault()
    {
        var api = NewsApi();
        var model = await LoadNewsAsync(api);

        Assert.True(model.IsNewsSection);
        Assert.NotEmpty(api.ManagedAnnouncementsCalls);
        Assert.All(api.ManagedAnnouncementsCalls,
            call => Assert.Equal("draft", call.Status));
        Assert.Equal("draft", model.SelectedNewsStatus);
        Assert.Equal("2 новости", model.TotalText);

        // Справочники редактора подтянуты (категории — без неактивных).
        Assert.Equal(false, api.LastAnnouncementCategoriesIncludeInactive);

        var row = model.News.First(n => n.Id == "n-1");
        Assert.Equal("Черновик", row.StatusText);
        Assert.Equal("muted", row.StatusTone);
        Assert.Equal("Черновик один", row.Title);
        Assert.Equal("Автор Один", row.AuthorText);
        Assert.Equal("ИТ", row.CategoryText);
        Assert.Equal("релиз", row.TagsText);
        Assert.True(row.HasRequiresAck);
        Assert.True(row.CanEdit);
        Assert.True(row.CanPublish);
        Assert.True(row.CanArchive);
        // DELETE — announcements.moderate; у writer кнопки нет.
        Assert.False(row.CanDelete);

        // Чужой черновик без can_manage — read-only для writer.
        var foreign = model.News.First(n => n.Id == "n-3");
        Assert.False(foreign.CanEdit);
        Assert.False(foreign.CanPublish);
        Assert.False(foreign.CanArchive);
        Assert.False(foreign.CanViewStats);
    }

    [Fact]
    public async Task NewsChipSwitchReloadsWithStatus()
    {
        var api = NewsApi();
        var model = await LoadNewsAsync(api);
        api.ManagedAnnouncementsCalls.Clear();

        model.NewsChips.First(c => c.Value == "published").IsChecked = true;
        await WaitFor(() => api.ManagedAnnouncementsCalls.Count == 1
            && model.News.Count == 1);

        Assert.Equal("published", api.ManagedAnnouncementsCalls[0].Status);
        Assert.Equal("published", model.SelectedNewsStatus);
        var row = Assert.Single(model.News);
        Assert.Equal("Опубликованная новость", row.Title);
        Assert.Equal("Опубликована", row.StatusText);
        Assert.Equal("success", row.StatusTone);
        Assert.Equal("@editor", row.AuthorText);
        Assert.False(row.CanPublish); // уже опубликована — повторный POST не нужен
        Assert.True(row.CanArchive);
    }

    [Fact]
    public async Task NewsSearchFiltersLocally()
    {
        var api = NewsApi();
        var model = await LoadNewsAsync(api);
        var calls = api.ManagedAnnouncementsCalls.Count;

        model.SearchText = "бетон";

        var row = Assert.Single(model.News);
        Assert.Equal("Бетонные работы", row.Title);

        model.SearchText = "автор один";
        Assert.Equal("n-1", Assert.Single(model.News).Id);

        model.SearchText = string.Empty;
        Assert.Equal(2, model.News.Count);
        // Поиск локальный — сервер не дёргался.
        Assert.Equal(calls, api.ManagedAnnouncementsCalls.Count);
    }

    [Fact]
    public async Task NewsCreateDraftGoesToDraftsRoute()
    {
        var api = NewsApi();
        var model = await LoadNewsAsync(api);

        model.CreateNewsCommand.Execute(null);
        var editor = model.NewsEditor;
        Assert.NotNull(editor);
        Assert.True(editor.IsCreateMode);
        Assert.Equal("Опубликовать", editor.SubmitText);
        Assert.True(model.IsNewsEditorOpen);

        // Валидация до запроса.
        Assert.False(await editor.SubmitAsync(publish: false));
        Assert.True(editor.HasError);
        Assert.Empty(api.AnnouncementDraftCalls);

        editor.Title = "  Новая  ";
        editor.TagsText = "релиз, инфра; #релиз"; // дедуп без регистра
        editor.RequiresAck = true;
        Assert.True(await editor.SubmitAsync(publish: false));

        // Без файлов черновик уходит JSON-роутом /drafts, не multipart POST.
        var draft = Assert.Single(api.AnnouncementDraftCalls);
        Assert.Empty(api.AnnouncementCreateCalls);
        Assert.Equal("Новая", draft.Title);
        Assert.Equal("draft", draft.Status);
        Assert.Equal(["релиз", "инфра"], draft.Tags);
        Assert.True(draft.RequiresAck);

        // Оверлей закрыт, созданный черновик виден в draft-выдаче.
        Assert.Null(model.NewsEditor);
        Assert.Contains(model.News, n => n.Title == "Новая");
    }

    [Fact]
    public async Task NewsCreatePublishWithPickedFilePostsMultipart()
    {
        var api = NewsApi();
        var model = await LoadNewsAsync(api);
        var file = Path.Combine(
            Path.GetTempPath(), $"hub-news-test-{Guid.NewGuid():N}.txt");
        await File.WriteAllTextAsync(file, "payload");
        try
        {
            model.NewsFilePicker = () => [file];
            model.CreateNewsCommand.Execute(null);
            var editor = model.NewsEditor;
            Assert.NotNull(editor);
            editor.Title = "С файлом";
            editor.AddFilesCommand.Execute(null);

            var attachment = Assert.Single(editor.Attachments);
            Assert.Equal(Path.GetFileName(file), attachment.Name);
            Assert.True(editor.HasAttachments);

            Assert.True(await editor.SubmitAsync(publish: true));

            var create = Assert.Single(api.AnnouncementCreateCalls);
            Assert.Equal("С файлом", create.Title);
            Assert.Equal("published", create.Status);
            Assert.Empty(api.AnnouncementDraftCalls);
            var files = Assert.Single(api.AnnouncementCreateFileCalls);
            var outgoing = Assert.Single(files);
            Assert.Equal(Path.GetFileName(file), outgoing.FileName);
            Assert.Equal("payload", System.Text.Encoding.UTF8.GetString(outgoing.Content.ToArray()));
        }
        finally
        {
            File.Delete(file);
        }
    }

    [Fact]
    public async Task NewsEditPatchesOnlyChangedFields()
    {
        var api = NewsApi();
        var model = await LoadNewsAsync(api);

        model.EditNewsCommand.Execute(model.News.First(n => n.Id == "n-1"));
        var editor = model.NewsEditor;
        Assert.NotNull(editor);
        Assert.False(editor.IsCreateMode);
        Assert.Equal("Сохранить", editor.SubmitText);
        Assert.Equal("Черновик один", editor.Title);
        Assert.True(editor.RequiresAck);
        Assert.True(editor.IsPriorityNormal);

        editor.Title = "Обновлённый заголовок";
        editor.RequiresAck = false;
        Assert.True(await editor.SubmitAsync(publish: true));

        var (id, patch) = Assert.Single(api.AnnouncementUpdateCalls);
        Assert.Equal("n-1", id);
        Assert.Equal("Обновлённый заголовок", patch.Title);
        Assert.False(patch.RequiresAck);
        // exclude_unset: нетронутые поля — null, сервер их не меняет.
        Assert.Null(patch.Preview);
        Assert.Null(patch.Body);
        Assert.Null(patch.Priority);
        Assert.Null(patch.CategoryId);
        Assert.Null(patch.Tags);
        Assert.Null(patch.IsPinned);
        // Смена статуса из правки не уходит — переходы только publish/archive.
        Assert.Empty(api.AnnouncementPublishCalls);
        Assert.Null(model.NewsEditor);
    }

    [Fact]
    public async Task NewsEditWithoutChangesDoesNotCallApi()
    {
        var api = NewsApi();
        var model = await LoadNewsAsync(api);

        model.EditNewsCommand.Execute(model.News.First(n => n.Id == "n-1"));
        var editor = model.NewsEditor;
        Assert.NotNull(editor);

        Assert.False(await editor.SubmitAsync(publish: true));
        Assert.Equal("Изменений нет.", editor.StatusText);
        Assert.Empty(api.AnnouncementUpdateCalls);
        Assert.NotNull(model.NewsEditor); // Saved не вызывался — оверлей открыт.
    }

    [Fact]
    public async Task NewsPublishAndArchiveReloadStatusList()
    {
        var api = NewsApi();
        var model = await LoadNewsAsync(api);
        var calls = api.ManagedAnnouncementsCalls.Count;

        await ((NativeAsyncCommand)model.PublishNewsCommand)
            .ExecuteAsync(model.News.First(n => n.Id == "n-1"));

        Assert.Equal(["n-1"], api.AnnouncementPublishCalls);
        // Перечитана draft-выдача: n-1 ушла в published.
        Assert.Equal(calls + 1, api.ManagedAnnouncementsCalls.Count);
        Assert.Equal("draft", api.ManagedAnnouncementsCalls.Last().Status);
        Assert.DoesNotContain(model.News, n => n.Id == "n-1");

        // Переключаемся на published и архивируем оттуда.
        model.NewsChips.First(c => c.Value == "published").IsChecked = true;
        await WaitFor(() => model.News.Any(n => n.Id == "n-2"));
        await ((NativeAsyncCommand)model.ArchiveNewsCommand)
            .ExecuteAsync(model.News.First(n => n.Id == "n-2"));

        Assert.Equal(["n-2"], api.AnnouncementArchiveCalls);
        await WaitFor(() => model.News.All(n => n.Id != "n-2"));
    }

    [Fact]
    public async Task NewsDeleteArmsThenDeletesForModerator()
    {
        var api = NewsApi(user: AdminUser);
        var model = await LoadNewsAsync(api);
        var row = model.News.First(n => n.Id == "n-1");

        Assert.True(row.CanDelete);
        Assert.Equal("Удалить", row.DeleteText);

        // Первое нажатие — только взводит.
        await ((NativeAsyncCommand)model.DeleteNewsCommand).ExecuteAsync(row);
        Assert.Empty(api.AnnouncementDeleteCalls);
        Assert.Equal("Удалить?", row.DeleteText);

        // Второе — удаляет и перечитывает выдачу.
        await ((NativeAsyncCommand)model.DeleteNewsCommand).ExecuteAsync(row);
        Assert.Equal(["n-1"], api.AnnouncementDeleteCalls);
        Assert.DoesNotContain(model.News, n => n.Id == "n-1");

        // Writer (write без moderate) вообще не может удалять — команда no-op.
        var writerApi = NewsApi();
        var writer = await LoadNewsAsync(writerApi);
        var foreign = writer.News.First(n => n.Id == "n-1");
        Assert.False(foreign.CanDelete);
        await ((NativeAsyncCommand)writer.DeleteNewsCommand).ExecuteAsync(foreign);
        Assert.Empty(writerApi.AnnouncementDeleteCalls);
    }

    [Fact]
    public async Task NewsStatsOverlayLoadsAnalytics()
    {
        var api = NewsApi();
        api.AnnouncementAnalytics = new HubAnnouncementAnalytics
        {
            Summary = new HubAnnouncementAnalyticsSummary
            {
                RecipientsTotal = 10,
                SeenTotal = 4,
                AckTotal = 2,
                PendingAckTotal = 6,
                CommentsTotal = 1,
            },
            Items =
            [
                new HubAnnouncementReadItem
                {
                    UserId = 7, Username = "reader", FullName = "Читатель",
                    IsSeen = true, IsAcknowledged = true,
                },
            ],
        };
        var model = await LoadNewsAsync(api);

        model.NewsStatsCommand.Execute(model.News.First(n => n.Id == "n-1"));
        var stats = model.NewsStats;
        Assert.NotNull(stats);
        Assert.True(model.IsNewsStatsOpen);
        await WaitFor(() => api.AnnouncementAnalyticsCalls.Count == 1 && !stats.IsLoading);

        Assert.Equal(["n-1"], api.AnnouncementAnalyticsCalls);
        Assert.Contains("Прочитано: 4 из 10", stats.SummaryText);
        Assert.Contains("Подтвердили: 2", stats.SummaryText);
        var reader = Assert.Single(stats.Readers);
        Assert.Equal("Читатель", reader.Title);
        Assert.Equal("@reader", reader.UsernameText);
        Assert.Equal("Прочитано", reader.StatusText);
        Assert.Equal("✓ Подтверждено", reader.AckText);

        stats.CloseCommand.Execute(null);
        Assert.Null(model.NewsStats);
    }

    [Fact]
    public async Task NewsLoadErrorGoesToBannerAnd403ToDeniedHint()
    {
        // Транспортная ошибка — баннер через onError команды выбора раздела.
        var api = NewsApi(user: AdminUser);
        api.ManagedAnnouncementsException =
            new HubApiException(HubApiErrorKind.Transport, "down");
        var model = new AdminViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.SelectSectionCommand)
            .ExecuteAsync(model.Sections.First(s => s.Key == "news"));
        Assert.True(model.HasBannerError);
        Assert.Contains("соединения", model.BannerErrorText, StringComparison.OrdinalIgnoreCase);

        // 403 — подсказка раздела (право могли отозвать после /auth/me).
        var denied = NewsApi(user: AdminUser);
        denied.ManagedAnnouncementsException = new HubApiException(
            HubApiErrorKind.Http, "forbidden", HttpStatusCode.Forbidden);
        var deniedModel = new AdminViewModel(denied);
        await deniedModel.LoadAsync();
        await ((NativeAsyncCommand)deniedModel.SelectSectionCommand)
            .ExecuteAsync(deniedModel.Sections.First(s => s.Key == "news"));
        Assert.True(deniedModel.HasSectionDenied);
        Assert.Contains("Недостаточно прав", deniedModel.SectionDeniedText);
        Assert.False(deniedModel.HasBannerError);
    }

    [Fact]
    public async Task ResetClearsNewsState()
    {
        var api = NewsApi();
        var model = await LoadNewsAsync(api);
        Assert.NotEmpty(model.News);
        model.CreateNewsCommand.Execute(null);
        Assert.NotNull(model.NewsEditor);
        model.NewsChips.First(c => c.Value == "published").IsChecked = true;
        await WaitFor(() => model.SelectedNewsStatus == "published");

        model.Reset();

        Assert.Empty(model.News);
        Assert.Null(model.NewsEditor);
        Assert.Null(model.NewsStats);
        Assert.False(model.CanCreateNews);
        Assert.Equal("draft", model.SelectedNewsStatus);
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
