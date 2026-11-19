using System.Net;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NativeGroupsAccessViewModelTests
{
    private const string DnRead = "CN=DL-Folder-Read,OU=Groups,DC=corp,DC=local";
    private const string DnWrite = "CN=DL-Folder-Write,OU=Groups,DC=corp,DC=local";

    // ---- Загрузка матрицы ----

    [Fact]
    public async Task LoadFillsMatrixAndQueriesStatus()
    {
        var api = new FakeHubApiClient
        {
            GroupsAccessStatus = new HubGroupsAccessStatus
            {
                Status = "ok",
                LastSyncAt = "2026-01-12T10:30:00Z",
                Branches = ["SPb", "Tyumen"],
            },
            GroupsAccessMatrix = MatrixWith(),
        };
        var model = new GroupsAccessViewModel(api);

        await model.LoadAsync();

        Assert.Equal(1, api.GroupsAccessStatusCallCount);
        var query = Assert.Single(api.GroupsAccessMatrixQueries);
        // Контракт веб-страницы: MATRIX_GROUP_LIMIT=250, MATRIX_USER_LIMIT=500.
        Assert.Equal(250, query.GroupLimit);
        Assert.Equal(500, query.UserLimit);
        Assert.Null(query.Branch);
        Assert.Null(query.FolderQuery);
        Assert.Null(query.UserQuery);

        Assert.Equal(2, model.MatrixGroups.Count);
        Assert.Equal("Папка общая", model.MatrixGroups[0].Title);
        Assert.Equal("R", model.MatrixGroups[0].LevelMark);
        Assert.Equal("Чтение", model.MatrixGroups[0].LevelLabel);
        Assert.Equal("info", model.MatrixGroups[0].LevelTone);
        Assert.Equal("3 участника", model.MatrixGroups[0].MembersCountText);
        Assert.Equal(DnRead, model.MatrixGroups[0].Dn);
        Assert.True(model.HasMatrix);
        Assert.False(model.IsEmpty);
        Assert.False(model.IsLoading);
        Assert.False(model.HasBannerError);
        Assert.StartsWith("Снимок: ", model.SyncedAtText);
        Assert.Equal("1 учёток × 2 папок · 2 доступов", model.SummaryText);
        Assert.Equal(string.Empty, model.TruncatedText);
    }

    [Fact]
    public async Task SparseCellsBecomeAccessMarks()
    {
        var api = new FakeHubApiClient
        {
            GroupsAccessMatrix = MatrixWith(
                cells:
                [
                    ["ivanov", DnRead, "read"],
                    ["ivanov", DnWrite, "full"],
                ]),
        };
        var model = new GroupsAccessViewModel(api);
        await model.LoadAsync();

        var row = Assert.Single(model.MatrixRows);
        Assert.Equal("Иван Иванов", row.UserText);
        Assert.Equal("ivanov", row.Login);
        Assert.Equal(2, row.Cells.Length);
        Assert.Equal("R", row.Cells[0].Mark);
        Assert.Equal("Чтение", row.Cells[0].Label);
        Assert.True(row.Cells[0].HasAccess);
        Assert.Equal("F", row.Cells[1].Mark);
        Assert.Equal("Полный", row.Cells[1].Label);
        Assert.Equal("error", row.Cells[1].Tone);
    }

    [Fact]
    public async Task MissingCellShowsNoAccessDot()
    {
        var api = new FakeHubApiClient
        {
            GroupsAccessMatrix = MatrixWith(cells: []),
        };
        var model = new GroupsAccessViewModel(api);
        await model.LoadAsync();

        var row = Assert.Single(model.MatrixRows);
        Assert.Equal("·", row.Cells[0].Mark);
        Assert.False(row.Cells[0].HasAccess);
        Assert.Equal("Нет доступа", row.Cells[0].Label);
        Assert.Equal("muted", row.Cells[0].Tone);
        // member-уровень — «+».
        var api2 = new FakeHubApiClient
        {
            GroupsAccessMatrix = MatrixWith(cells: [["ivanov", DnRead, "member"]]),
        };
        var model2 = new GroupsAccessViewModel(api2);
        await model2.LoadAsync();
        Assert.Equal("+", model2.MatrixRows[0].Cells[0].Mark);
        Assert.Equal("Доступ", model2.MatrixRows[0].Cells[0].Label);
    }

    [Fact]
    public async Task EmptyMatrixShowsEmptyState()
    {
        var api = new FakeHubApiClient
        {
            GroupsAccessMatrix = new HubGroupsAccessMatrixGrid
            {
                Groups = [],
                Users = [],
                Cells = [],
            },
        };
        var model = new GroupsAccessViewModel(api);

        await model.LoadAsync();

        Assert.Empty(model.MatrixGroups);
        Assert.Empty(model.MatrixRows);
        Assert.True(model.IsEmpty);
        Assert.False(model.HasMatrix);
    }

    [Fact]
    public async Task MatrixErrorShowsBanner()
    {
        var api = new FakeHubApiClient
        {
            GroupsAccessMatrixException = new HubApiException(
                HubApiErrorKind.Http, "forbidden", HttpStatusCode.Forbidden),
        };
        var model = new GroupsAccessViewModel(api);

        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);

        Assert.Equal("Недостаточно прав для этого действия.", model.BannerErrorText);
        Assert.True(model.HasBannerError);
        Assert.False(model.IsLoading);

        model.DismissBannerCommand.Execute(null);
        Assert.False(model.HasBannerError);
    }

    [Fact]
    public async Task StatusErrorDoesNotBlockMatrix()
    {
        var api = new FakeHubApiClient
        {
            GroupsAccessStatusException = new HubApiException(HubApiErrorKind.Transport, "down"),
            GroupsAccessMatrix = MatrixWith(),
        };
        var model = new GroupsAccessViewModel(api);

        await model.LoadAsync();

        // Статус не критичен: матрица загружена, ветки — дефолтные.
        Assert.Equal(2, model.MatrixGroups.Count);
        Assert.False(model.HasBannerError);
        Assert.Equal(3, model.BranchItems.Count);
        Assert.Equal("Все", model.BranchItems[0].Label);
        Assert.Equal("SPb", model.BranchItems[1].Label);
    }

    [Fact]
    public async Task StatusNeverShowsHint()
    {
        var api = new FakeHubApiClient
        {
            GroupsAccessStatus = new HubGroupsAccessStatus { Status = "never" },
            GroupsAccessMatrix = MatrixWith(),
        };
        var model = new GroupsAccessViewModel(api);

        await model.LoadAsync();

        Assert.True(model.HasStatusHint);
        Assert.Contains("не создавался", model.StatusHintText);
    }

    [Fact]
    public async Task TruncatedSummaryShowsWarning()
    {
        var api = new FakeHubApiClient
        {
            GroupsAccessMatrix = MatrixWith(
                summary: new HubGroupsAccessSummary
                {
                    GroupCount = 400,
                    UserCount = 900,
                    ReturnedGroupCount = 250,
                    ReturnedUserCount = 500,
                    GroupTruncated = true,
                    UserTruncated = true,
                    Truncated = true,
                }),
        };
        var model = new GroupsAccessViewModel(api);

        await model.LoadAsync();

        Assert.True(model.HasTruncated);
        Assert.Contains("250 из 400", model.TruncatedText);
        Assert.Contains("500 из 900", model.TruncatedText);
    }

    // ---- Ветки ----

    [Fact]
    public async Task BranchChipsFromStatusAndSelectionReloadsWithBranch()
    {
        var api = new FakeHubApiClient
        {
            GroupsAccessStatus = new HubGroupsAccessStatus
            {
                Status = "ok",
                Branches = ["SPb", "Tyumen"],
            },
            GroupsAccessMatrix = MatrixWith(),
        };
        var model = new GroupsAccessViewModel(api);
        await model.LoadAsync();
        Assert.Equal(3, model.BranchItems.Count);
        Assert.Equal("", model.SelectedBranchValue);
        Assert.False(model.HasActiveFilters);

        model.BranchItems[1].IsChecked = true;
        await WaitFor(() => api.GroupsAccessMatrixQueries.Count == 2);

        Assert.Equal("SPb", model.SelectedBranchValue);
        Assert.Equal("SPb", api.GroupsAccessMatrixQueries[1].Branch);
        Assert.True(model.HasActiveFilters);
        // Радиогруппа: «Все» снят.
        Assert.False(model.BranchItems[0].IsChecked);
        Assert.True(model.BranchItems[1].IsChecked);
    }

    // ---- Поиск (debounce) ----

    [Fact]
    public async Task UserQueryReloadsWithUserQ()
    {
        var api = new FakeHubApiClient { GroupsAccessMatrix = MatrixWith() };
        var model = new GroupsAccessViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();

        model.UserQuery = "  иванов  ";
        await WaitFor(() => api.GroupsAccessMatrixQueries.Count == 2);

        // Серверный параметр user_q, пробелы нормализованы.
        Assert.Equal("иванов", api.GroupsAccessMatrixQueries[1].UserQuery);
        Assert.True(model.HasActiveFilters);
    }

    [Fact]
    public async Task FolderQueryReloadsWithFolderQ()
    {
        var api = new FakeHubApiClient { GroupsAccessMatrix = MatrixWith() };
        var model = new GroupsAccessViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();

        model.FolderQuery = "общая";
        await WaitFor(() => api.GroupsAccessMatrixQueries.Count == 2);

        Assert.Equal("общая", api.GroupsAccessMatrixQueries[1].FolderQuery);
        Assert.Null(api.GroupsAccessMatrixQueries[1].UserQuery);
    }

    [Fact]
    public async Task DebounceCoalescesTyping()
    {
        var api = new FakeHubApiClient { GroupsAccessMatrix = MatrixWith() };
        var model = new GroupsAccessViewModel(api);
        await model.LoadAsync();
        Assert.Single(api.GroupsAccessMatrixQueries);

        var releases = new List<TaskCompletionSource>();
        model.DelayAsync = (_, ct) =>
        {
            var release = new TaskCompletionSource();
            ct.Register(() => release.TrySetCanceled(ct));
            releases.Add(release);
            return release.Task;
        };

        model.UserQuery = "i";
        model.UserQuery = "iv";
        Assert.Equal(2, releases.Count);
        // Первый ввод отменён — на сервер пойдёт только последнее значение.
        releases[1].TrySetResult();
        await WaitFor(() => api.GroupsAccessMatrixQueries.Count == 2);

        Assert.Equal("iv", api.GroupsAccessMatrixQueries[1].UserQuery);
        Assert.DoesNotContain(api.GroupsAccessMatrixQueries, q => q.UserQuery == "i");
    }

    [Fact]
    public async Task ClearFiltersResetsQueriesAndReloads()
    {
        var api = new FakeHubApiClient
        {
            GroupsAccessStatus = new HubGroupsAccessStatus
            {
                Status = "ok",
                Branches = ["SPb", "Tyumen"],
            },
            GroupsAccessMatrix = MatrixWith(),
        };
        var model = new GroupsAccessViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        model.UserQuery = "ivan";
        await WaitFor(() => api.GroupsAccessMatrixQueries.Count == 2);
        model.BranchItems[1].IsChecked = true;
        await WaitFor(() => api.GroupsAccessMatrixQueries.Count == 3);

        model.ClearFiltersCommand.Execute(null);
        await WaitFor(() => api.GroupsAccessMatrixQueries.Count == 4);

        var last = api.GroupsAccessMatrixQueries[3];
        Assert.Null(last.UserQuery);
        Assert.Null(last.FolderQuery);
        Assert.Null(last.Branch);
        Assert.Equal(string.Empty, model.UserQuery);
        Assert.Equal(string.Empty, model.FolderQuery);
        Assert.Equal("", model.SelectedBranchValue);
        Assert.True(model.BranchItems[0].IsChecked);
        Assert.False(model.BranchItems[1].IsChecked);
        Assert.False(model.HasActiveFilters);
    }

    // ---- Карточка группы ----

    [Fact]
    public async Task SelectingCellLoadsGroupDetailWithMembers()
    {
        var api = new FakeHubApiClient
        {
            GroupsAccessMatrix = MatrixWith(
                cells: [["ivanov", DnRead, "read"]]),
            GroupsAccessGroupDetail = new HubGroupsAccessGroupDetail
            {
                Group = new HubGroupsAccessGroup
                {
                    Dn = DnRead,
                    Cn = "DL-Folder-Read",
                    MemberCount = 2,
                    Description = "Общая папка отдела",
                },
                Members =
                [
                    new HubGroupsAccessMember { Login = "ivanov", DisplayName = "Иван Иванов" },
                    new HubGroupsAccessMember { Login = "petrov" },
                ],
            },
        };
        var model = new GroupsAccessViewModel(api);
        await model.LoadAsync();

        model.SelectMatrixCell(model.MatrixRows[0], 0);
        await WaitFor(() => api.GroupsAccessGroupDetailCalls.Count == 1 && !model.IsDetailLoading);

        Assert.Equal([DnRead], api.GroupsAccessGroupDetailCalls);
        var detail = model.Detail!;
        Assert.Equal(DnRead, detail.Dn);
        Assert.Equal("Общая папка отдела", detail.DescriptionText);
        Assert.Equal("2 участника", detail.MemberCountText);
        Assert.Equal(2, detail.Members.Count);
        Assert.Equal("Участники · 2", detail.MembersTitleText);
        Assert.Equal("Иван Иванов", detail.Members[0].Title);
        Assert.Equal("petrov", detail.Members[1].Title);
        Assert.Equal(string.Empty, detail.Members[1].LoginText);
        // Контекст выбранной ячейки: «учётка — уровень».
        Assert.Equal("Иван Иванов — Чтение", model.SelectionContextText);
        Assert.True(model.HasDetail);
        Assert.False(model.HasDetailError);
    }

    [Fact]
    public async Task DetailErrorShowsDetailErrorText()
    {
        var api = new FakeHubApiClient
        {
            GroupsAccessMatrix = MatrixWith(),
            GroupsAccessGroupDetailException = new HubApiException(
                HubApiErrorKind.Http, "not found", HttpStatusCode.NotFound),
        };
        var model = new GroupsAccessViewModel(api);
        await model.LoadAsync();

        model.SelectMatrixCell(model.MatrixRows[0], 0);
        await WaitFor(() => api.GroupsAccessGroupDetailCalls.Count == 1 && !model.IsDetailLoading);

        Assert.True(model.HasDetailError);
        // Карточка из данных матрицы видна — ошибка только в строке детали.
        Assert.NotNull(model.Detail);
        Assert.False(model.HasBannerError);
    }

    [Fact]
    public async Task StaleSelectionClearedWhenGroupLeavesResult()
    {
        var api = new FakeHubApiClient
        {
            GroupsAccessMatrix = MatrixWith(),
        };
        api.GroupsAccessMatrixFactory = query => string.IsNullOrEmpty(query.FolderQuery)
            ? MatrixWith()
            : MatrixWith(
                groups: [Group(DnWrite, "DL-Folder-Write", "Папка заявок", "write")],
                cells: []);
        var model = new GroupsAccessViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        model.SelectMatrixCell(model.MatrixRows[0], 0);
        await WaitFor(() => api.GroupsAccessGroupDetailCalls.Count == 1);
        Assert.NotNull(model.Detail);

        model.FolderQuery = "заяв";
        await WaitFor(() => api.GroupsAccessMatrixQueries.Count == 2);

        // Выбранной группы нет в новой выборке — деталь закрыта.
        Assert.Null(model.Detail);
        Assert.Null(model.SelectedGroup);
        Assert.Equal(-1, model.SelectedGroupIndex);
        Assert.True(model.ShowDetailPlaceholder);
    }

    [Fact]
    public async Task ClosingDetailClearsSelection()
    {
        var api = new FakeHubApiClient { GroupsAccessMatrix = MatrixWith() };
        var model = new GroupsAccessViewModel(api);
        await model.LoadAsync();
        model.SelectMatrixCell(model.MatrixRows[0], 0);
        await WaitFor(() => api.GroupsAccessGroupDetailCalls.Count == 1);
        Assert.NotNull(model.Detail);

        model.CloseDetailCommand.Execute(null);

        Assert.Null(model.Detail);
        Assert.Null(model.SelectedGroup);
        Assert.Null(model.SelectedUser);
    }

    // ---- Сброс ----

    [Fact]
    public async Task ResetClearsState()
    {
        var api = new FakeHubApiClient
        {
            GroupsAccessStatus = new HubGroupsAccessStatus
            {
                Status = "ok",
                Branches = ["SPb", "Tyumen"],
            },
            GroupsAccessMatrix = MatrixWith(),
        };
        var model = new GroupsAccessViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        model.SelectMatrixCell(model.MatrixRows[0], 0);
        await WaitFor(() => api.GroupsAccessGroupDetailCalls.Count == 1);
        model.UserQuery = "ivan";
        await WaitFor(() => api.GroupsAccessMatrixQueries.Count == 2);

        model.Reset();

        Assert.Empty(model.MatrixGroups);
        Assert.Empty(model.MatrixRows);
        Assert.Null(model.Detail);
        Assert.Null(model.SelectedGroup);
        Assert.Null(model.SelectedUser);
        Assert.Equal(-1, model.SelectedGroupIndex);
        Assert.True(model.ShowDetailPlaceholder);
        Assert.Equal(string.Empty, model.UserQuery);
        Assert.Equal(string.Empty, model.FolderQuery);
        Assert.Equal("", model.SelectedBranchValue);
        Assert.Equal(3, model.BranchItems.Count);
        Assert.True(model.BranchItems[0].IsChecked);
        Assert.Equal(string.Empty, model.SummaryText);
        Assert.Equal(string.Empty, model.TruncatedText);
        Assert.Equal(string.Empty, model.SyncedAtText);
        Assert.Equal(string.Empty, model.StatusHintText);
        Assert.Equal(string.Empty, model.LastUpdatedText);
        Assert.False(model.HasBannerError);
        Assert.False(model.HasDetailError);
        Assert.False(model.HasActiveFilters);
        Assert.False(model.IsLoading);
        Assert.False(model.IsDetailLoading);
        Assert.True(model.IsEmpty);
    }

    // ---- Данные ----

    private static HubGroupsAccessGroup Group(
        string dn,
        string cn,
        string folderLabel,
        string accessLevel) => new()
    {
        Dn = dn,
        Cn = cn,
        Branch = "SPb",
        FolderLabel = folderLabel,
        FolderPath = "OU=Groups,DC=corp,DC=local",
        AccessLevel = accessLevel,
        MemberCount = 3,
        Description = string.Empty,
    };

    private static HubGroupsAccessMatrixGrid MatrixWith(
        HubGroupsAccessGroup[]? groups = null,
        HubGroupsAccessUser[]? users = null,
        IReadOnlyList<IReadOnlyList<string>>? cells = null,
        HubGroupsAccessSummary? summary = null) => new()
    {
        SyncedAt = "2026-01-12T10:30:00Z",
        Branch = "all",
        Groups = groups ??
            [
                Group(DnRead, "DL-Folder-Read", "Папка общая", "read"),
                Group(DnWrite, "DL-Folder-Write", "Папка заявок", "write"),
            ],
        Users = users ??
            [
                new HubGroupsAccessUser
                {
                    Login = "ivanov",
                    DisplayName = "Иван Иванов",
                    AccessCount = 1,
                },
            ],
        Cells = cells ?? [["ivanov", DnRead, "read"], ["ivanov", DnWrite, "write"]],
        Summary = summary,
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
